#!/usr/bin/env python3
"""对单个真实JDK/Boot/Dubbo样例组合执行跨进程验收，不访问公司配置。"""
import argparse
import concurrent.futures
import hashlib
import http.client
import json
import os
from pathlib import Path
import base64
import struct
import signal
import socket
import subprocess
import tempfile
import time
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--java', required=True)
parser.add_argument('--jar', required=True)
parser.add_argument('--label', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--protocols', choices=('http', 'dubbo', 'both'), default='both')
args = parser.parse_args()

def free_port(family, address):
    with socket.socket(family) as listener:
        listener.bind((address, 0))
        return listener.getsockname()[1]

http_enabled = args.protocols in ('http', 'both')
dubbo_enabled = args.protocols in ('dubbo', 'both')
http_port = free_port(socket.AF_INET, '127.0.0.1') if http_enabled else 0
dubbo_port = free_port(socket.AF_INET6, '::1') if dubbo_enabled else 0
report = {'label': args.label, 'protocols': args.protocols, 'httpChecks': 0, 'dubboChecks': 0, 'jarSha256': hashlib.sha256(Path(args.jar).read_bytes()).hexdigest()}
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='runtime-', dir=output))
with zipfile.ZipFile(args.jar) as archive:
    names = archive.namelist()
report['hasDubboLibrary'] = any('/dubbo-' in name and name.endswith('.jar') for name in names)
report['hasMvcLibrary'] = any('/spring-webmvc-' in name and name.endswith('.jar') for name in names)
assert report['hasDubboLibrary'] == dubbo_enabled, 'jar protocol classpath does not match requested Dubbo mode'
assert report['hasMvcLibrary'] == http_enabled, 'jar protocol classpath does not match requested HTTP mode'
os.chmod(work, 0o700)
keys = {}
public_keys = {}
for key_id in ('current', 'previous'):
    key_file = work / (key_id + '.pem')
    subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key_file)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.chmod(key_file, 0o600)
    public = subprocess.check_output(['openssl', 'pkey', '-in', str(key_file), '-pubout', '-outform', 'DER'])
    public_keys[key_id] = base64.b64encode(public).decode()
    keys[key_id] = key_file
private_der = subprocess.check_output(['openssl', 'pkcs8', '-topk8', '-nocrypt', '-in', str(keys['current']), '-outform', 'DER'])
environment = dict(os.environ)
environment.pop('SAMPLE_GATEWAY_PRIVATE_KEY', None)
environment['SPRING_APPLICATION_JSON'] = json.dumps({'open-platform': {'provider': {'environment-id': 'local', 'public-keys': public_keys}}})
client_environment = dict(environment, SAMPLE_GATEWAY_PRIVATE_KEY=base64.b64encode(private_der).decode())
provider_log = (work/'provider.log').open('wb')
provider_arguments = [] if http_enabled else ['--spring.main.web-application-type=none']
process = subprocess.Popen([args.java, '-DsocksProxyHost=', '-jar', str(Path(args.jar).resolve()),
    '--server.port='+str(http_port), '--sample.dubbo.port='+str(dubbo_port),
    '--server.tomcat.threads.max=2', '--server.tomcat.threads.min-spare=2'] + provider_arguments,
    stdin=subprocess.DEVNULL, stdout=provider_log, stderr=subprocess.STDOUT, env=environment, start_new_session=True)

def headers(tenant='tenant', employee=False, supplied=None):
    result = [('x-open-platform-key-id', 'current' if supplied is None else supplied),
              ('x-open-platform-application-id', 'sample-app'), ('x-open-platform-app-key', 'sample-key'),
              ('x-open-platform-tenant-id', tenant), ('x-request-id', 'sample-request')]
    if employee:
        result.extend([('x-open-platform-user-id', 'user'), ('x-open-platform-employee-id', 'employee'), ('x-open-platform-employee-no', 'E1001')])
    return result

def signed_headers(path, values):
    if not values:
        return values
    claims = dict(values)
    key_id = claims['x-open-platform-key-id']
    issued_at = int(time.time())
    metadata = [('x-open-platform-proof-version', '3'), ('x-open-platform-environment-id', 'local'),
                ('x-open-platform-issued-at', str(issued_at)), ('x-open-platform-expires-at', str(issued_at + 30))]
    claims.update(metadata)
    names = ['x-open-platform-' + name for name in ['key-id', 'environment-id', 'issued-at', 'expires-at']]
    names += ['x-request-id']
    names += ['x-open-platform-' + name for name in ['application-id', 'app-key', 'tenant-id', 'user-id', 'employee-id', 'employee-no']]
    raw_path, separator, query = path.partition('?')
    fields = ['open-platform-proof-v3'] + [claims.get(name, '') for name in names]
    fields += ['HTTP', 'GET', raw_path, query]
    encoded = [field.encode('utf-8') for field in fields]
    frame = b''.join(struct.pack('>I', len(value)) + value for value in encoded)
    signature = subprocess.check_output(['openssl', 'dgst', '-sha256', '-sign', str(keys.get(key_id, keys['current']))], input=frame)
    return list(values) + metadata + [('x-open-platform-signature', base64.urlsafe_b64encode(signature).rstrip(b'=').decode())]

def request(path, values=()):
    connection = http.client.HTTPConnection('127.0.0.1', http_port, timeout=8)
    try:
        connection.putrequest('GET', path)
        for name, value in signed_headers(path, values):
            connection.putheader(name, value)
        connection.endheaders()
        response = connection.getresponse()
        return response.status, response.read().decode('utf-8')
    finally:
        connection.close()

def check(path, expected_status, expected_body=None, values=()):
    status, body = request(path, values)
    assert status == expected_status, (path, status, expected_status)
    if expected_body is not None:
        assert body == expected_body, (path, 'unexpected body')
    return 1

try:
    deadline = time.monotonic()+60
    while True:
        if process.poll() is not None:
            raise RuntimeError('provider exited before readiness; private log: '+str(work))
        try:
            if http_enabled:
                if request('/internal/health') == (200, 'empty'): break
            else:
                with socket.socket(socket.AF_INET6) as readiness:
                    readiness.settimeout(2)
                    readiness.connect(('::1', dubbo_port))
                break
        except (OSError, http.client.HTTPException): pass
        if time.monotonic() > deadline: raise TimeoutError('provider startup timeout; private log: '+str(work))
        time.sleep(.25)
    if http_enabled:
        report['httpChecks'] += check('/sdk/identity', 200, 'tenant', headers())
        report['httpChecks'] += check('/sdk/identity', 200, 'tenant', headers(supplied='previous'))
        report['httpChecks'] += check('/sdk/identity', 403)
        report['httpChecks'] += check('/sdk/identity', 403, values=headers(supplied='wrong'))
        report['httpChecks'] += check('/sdk/identity', 403, values=headers()+[('x-open-platform-signature', 'duplicate')])
        report['httpChecks'] += check('/sdk/identity', 403, values=headers()+[('x-open-platform-tenant-id', 'forged')])
        report['httpChecks'] += check('/sdk/identity', 400, values=headers()+[('x-open-platform-user-id', 'incomplete')])
        report['httpChecks'] += check('/sdk/employee', 403, values=headers())
        report['httpChecks'] += check('/sdk/employee', 200, 'E1001', headers(employee=True))
        for path in ['/path/protected', '/%70ath/protected', '/path;v=1/protected']:
            report['httpChecks'] += check(path, 403)
        for index in range(12):
            report['httpChecks'] += check('/sdk/forward', 200, 'tenant', headers())
            report['httpChecks'] += check('/sdk/forward-public', 200, 'present', headers())
            report['httpChecks'] += check('/sdk/failure', 500, values=headers())
            report['httpChecks'] += check('/internal/health', 200, 'empty')
        def asynchronous(index):
            return check('/sdk/async', 200, 'tenant-'+str(index), headers('tenant-'+str(index)))
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
            report['httpChecks'] += sum(workers.map(asynchronous, range(40)))
        report['httpChecks'] += check('/internal/health', 200, 'empty')
    if dubbo_enabled:
        with (work/'client.log').open('wb') as client_log:
            client = subprocess.run([args.java, '-DsocksProxyHost=', '-jar', str(Path(args.jar).resolve()), '--sdk-client='+str(dubbo_port)],
                stdin=subprocess.DEVNULL, stdout=client_log, stderr=subprocess.STDOUT, env=client_environment, timeout=60)
        assert client.returncode == 0, 'Dubbo client failed; private log: '+str(work)
        assert 'SDK_DUBBO_CHECKS=57' in (work/'client.log').read_text(errors='replace'), 'missing Dubbo completion'
        report['dubboChecks'] = 57
    report['success'] = True
except BaseException as error:
    report['success'] = False
    report['failure'] = str(error)
    raise
finally:
    report['providerExitBeforeCleanup'] = process.poll()
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    provider_log.close()
    for key_file in keys.values():
        key_file.unlink(missing_ok=True)
    report['providerStopped'] = process.poll() is not None
    report['privateLogs'] = str(work)
    (output/(args.label+'.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, ensure_ascii=False))
