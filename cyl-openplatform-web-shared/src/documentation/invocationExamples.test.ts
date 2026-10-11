import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { parseJson, stringifyJson } from '../json';
import { curlExample, documentOperation, invocationExampleProblem, javaExample, javascriptExample, okhttpJavaExample, okhttpMavenDependency, phpExample, pythonExample } from './invocationExamples';
import type { ApiDocument } from './types';

const operation = { service: 'orders', version: 'v01', method: 'query' };
const document: ApiDocument = {
  id: 'a1', draftRevision: 1, title: '订单查询', path: '/api/oauth/orders/v01/query', httpMethod: 'POST', scopeCodes: ['order.read'],
  requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, errorDefinitions: [], responseExample: {},
  requestExample: parseJson('{"amount":9007199254740993,"decimal":0.123456789012345678901,"enabled":false,"count":0,"text":"quote \' \\\" $(echo INJECTED) `echo INJECTED` \\u005c\\u005cu000a 中文😀","rows":[]}'),
};

test('cURL 在真实 POSIX shell 原样传输 JSON 与环境变量，保留大数并阻止正文命令展开', () => {
  const script = `curl() { printf '%s\\0' "$@"; printf 'BODY\\0'; cat; }\n${curlExample(document)}`;
  const output = execFileSync('/bin/sh', ['-c', script], {
    encoding: 'utf8', env: { OPEN_PLATFORM_BASE_URL: 'https://gateway.example.test/context/', OPEN_PLATFORM_TOKEN: 'ENV_ONLY_TOKEN' },
  });
  const [argumentsText, body] = output.split('BODY\0');
  const args = argumentsText.split('\0');
  expect(args[args.indexOf('--url') + 1]).toBe('https://gateway.example.test/context/api/oauth/orders/v01/query');
  expect(args).toContain('Authorization: Bearer ENV_ONLY_TOKEN');
  expect(args).toContain('Content-Type: application/json');
  expect(args).toContain('@-');
  expect(body).toBe(stringifyJson(document.requestExample, 2));
  expect(curlExample(document)).not.toContain('ENV_ONLY_TOKEN');
});

test('兼容的 Bearer SDK 示例保留完整正文及字面外部版本', () => {
    const code = javaExample(document, operation, 'BEARER');
    const literal = code.split('String json = ')[1].split(';\n        //')[0];
    const body = literal.split('\n                + ').map(part => JSON.parse(part) as string).join('');
    expect(body).toBe(stringifyJson(document.requestExample, 2));
    expect(code).toContain('"orders", "v01", "query", json');
    expect(code).toContain('result.statusCode() != 200');
    expect(code).toContain('result.requestId()');
    expect(code).toContain('result.body()');
    expect(code).not.toContain('HttpClient');
    expect(code).not.toContain('OPEN_PLATFORM_SIGNING_SECRET');
    expect(code).toContain('OPEN_PLATFORM_TOKEN');
});

test('OkHttp JDK8 示例直接使用文档路径、方法和 Bearer Token，并给出独立 Maven 依赖', () => {
  const code = okhttpJavaExample({ ...document, path: '/orders/query', httpMethod: 'PATCH' });
  const literal = code.split('String json = ')[1].split(';\n            byte[] bodyBytes')[0];
  expect(literal.split('\n                + ').map(part => JSON.parse(part) as string).join('')).toBe(stringifyJson(document.requestExample, 2));
  expect(code).toContain('"/orders/query"');
  expect(code).toContain('.method("PATCH", new RequestBody()');
  expect(code).toContain('.header("Authorization", "Bearer " + token)');
  expect(code).toContain('private static final OkHttpClient CLIENT');
  expect(code).toContain('.connectTimeout(3, TimeUnit.SECONDS)');
  expect(code).toContain('.callTimeout(10, TimeUnit.SECONDS)');
  expect(code).toContain('.retryOnConnectionFailure(false)');
  expect(code).toContain('.followRedirects(false)');
  expect(code).toContain('.followSslRedirects(false)');
  expect(code).toContain('try (Response response =');
  expect(code).not.toContain('OpenPlatformClient');
  expect(code).not.toContain('OPEN_PLATFORM_SIGNING_SECRET');
  expect(okhttpMavenDependency).toContain('<groupId>com.squareup.okhttp3</groupId>');
  expect(okhttpMavenDependency).toContain('<artifactId>okhttp</artifactId>');
  expect(okhttpMavenDependency).toContain('<version>4.12.0</version>');
});

test('后台仅 document 的调用保留兼容，标识不一致或不规范时不生成 SDK 操作', () => {
  expect(documentOperation(document)).toEqual(operation);
  expect(documentOperation(document, operation)).toEqual(operation);
  expect(documentOperation(document, { ...operation, version: 'v1' })).toBeUndefined();
  expect(documentOperation({ ...document, httpMethod: 'GET' })).toBeUndefined();
  expect(documentOperation({ ...document, path: '/api/oauth/orders/v01/query?next=x' })).toBeUndefined();
});

test('超64KiB请求拒绝所有调用代码，Java另按modified UTF-8限制常量而不截断业务示例', () => {
  const large = { ...document, requestExample: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`field${index}`, 'a'.repeat(9000)])) };
  const before = stringifyJson(large.requestExample);
  expect(() => curlExample(large)).toThrow('超过 64 KiB');
  expect(() => javaExample(large, operation, 'BEARER')).toThrow('超过 64 KiB');
  for (const generate of [okhttpJavaExample, javascriptExample, pythonExample, phpExample]) {
    expect(() => generate(large)).toThrow('超过 64 KiB');
  }
  expect(stringifyJson(large.requestExample)).toBe(before);
  const supplementary = { ...document, requestExample: { first: '😀'.repeat(4000), second: '😀'.repeat(4000), third: '😀'.repeat(4000) } };
  expect(invocationExampleProblem(stringifyJson(supplementary.requestExample, 2), 'CURL')).toBeUndefined();
  expect(() => javaExample(supplementary, operation, 'HMAC')).toThrow('内联字符串安全范围');
  expect(() => okhttpJavaExample(supplementary)).toThrow('内联字符串安全范围');
  expect(() => curlExample(supplementary)).not.toThrow();
});

// JAVA8_HOME 可显式选择 JDK8；先构建 examples/java-client 的运行依赖再执行此集成检查。
const java8Home = process.env.JAVA8_HOME ?? process.env.JAVA_HOME;
const javac = java8Home ? join(java8Home, 'bin/javac') : 'javac';
const java = java8Home ? join(java8Home, 'bin/java') : 'java';
const javaDependencies = resolve(process.cwd(), '../examples/java-client/target/dependency');
const javaVersion = spawnSync(javac, ['-version'], { encoding: 'utf8' });
const javaAvailable = /javac 1\.8\./.test(javaVersion.stdout + javaVersion.stderr)
  && existsSync(join(javaDependencies, 'okhttp-4.12.0.jar'));
const serverJavac = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/javac') : 'javac';
const serverJava = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
const serverJavaAvailable = Number((spawnSync(serverJavac, ['-version'], { encoding: 'utf8' }).stdout.match(/javac (\d+)/) ?? [])[1]) >= 17;

test.skipIf(!javaAvailable || !serverJavaAvailable)('生成的HMAC Java8代码通过SignedRequest验签及篡改拒绝，固定向量和部署前缀不变', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hmac-example-'));
  const secret = Buffer.alloc(32, 7), keyId = 'a'.repeat(32);
  const received: { path: string; body: string; valid: boolean }[] = [];
  const verifierSource = `import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import java.util.Base64;
public class VerifyExample {
  public static void main(String[] args) {
    byte[] body = Base64.getDecoder().decode(args[7]);
    byte[] key = Base64.getUrlDecoder().decode(args[8]);
    SignedRequest request = new SignedRequest(args[0], args[1], args[2], args[3].isEmpty() ? null : args[3], Long.parseLong(args[4]), args[5], args[6], body);
    if (!request.verifies(key)) throw new AssertionError("invalid signature");
    body[0] ^= 1;
    if (new SignedRequest(args[0], args[1], args[2], request.employeeNo(), request.timestamp(), args[5], args[6], body).verifies(key)) throw new AssertionError("accepted tamper");
  }
}`;
  let fixedVector = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const canonical = ['SZ-HMAC-SHA256', 'POST', request.url!, keyId,
      request.headers['x-sz-tenant'], request.headers['x-sz-employee'] ?? '',
      request.headers['x-sz-timestamp'], request.headers['x-sz-nonce'],
      createHash('sha256').update(body).digest('hex')].join('\n');
    const expected = 'SZ-HMAC-SHA256 ' + keyId + ':' + createHmac('sha256', secret).update(canonical).digest('hex');
    const authority = spawnSync(serverJava, ['-cp', directory, 'VerifyExample', request.url!, keyId,
      String(request.headers['x-sz-tenant']), String(request.headers['x-sz-employee'] ?? ''),
      String(request.headers['x-sz-timestamp']), String(request.headers['x-sz-nonce']),
      String(request.headers.authorization).split(':')[1], body.toString('base64'), secret.toString('base64url')]);
    const valid = authority.status === 0 && request.headers.authorization === expected
      && /^[0-9a-f]{32}$/.test(String(request.headers['x-sz-nonce']))
      && (fixedVector ? request.headers['x-sz-timestamp'] === '1700000000' && request.headers['x-sz-nonce'] === 'b'.repeat(32)
        : Math.abs(Number(request.headers['x-sz-timestamp']) - Date.now() / 1000) < 30);
    received.push({ path: request.url!, body: body.toString('utf8'), valid });
    response.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
    response.end('{"code":200,"data":{"sensitive":"NOT_FOR_LOGS"}}');
  });
  try {
    writeFileSync(join(directory, 'VerifyExample.java'), verifierSource);
    execFileSync(serverJavac, ['-encoding', 'UTF-8', '-d', directory,
      resolve(process.cwd(), '../cyl-openplatform-domain/src/main/java/io/github/chenyilei2016/openplatform/domain/signature/SignedRequest.java'), join(directory, 'VerifyExample.java')]);
    writeFileSync(join(directory, 'HmacExample.java'), javaExample(document, operation, 'HMAC'));
    execFileSync(javac, ['-encoding', 'UTF-8', '-cp', join(javaDependencies, '*'), join(directory, 'HmacExample.java')]);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务未启动');
    for (const [index, employeeNo] of ['', 'E1001', 'E1001'].entries()) {
      if (index === 2) {
        // 仅测试固定公开向量：不为生产示例增加时间戳/nonce覆盖入口。
        fixedVector = true;
        writeFileSync(join(directory, 'HmacExample.java'), javaExample(document, operation, 'HMAC')
          .replace('Long.toString(Instant.now().getEpochSecond())', '"1700000000"')
          .replace('UUID.randomUUID().toString().replace("-", "")', '"' + 'b'.repeat(32) + '"'));
        execFileSync(javac, ['-encoding', 'UTF-8', '-cp', join(javaDependencies, '*'), join(directory, 'HmacExample.java')]);
      }
      const result = await promisify(execFile)(java, ['-cp', directory + delimiter + join(javaDependencies, '*'), 'HmacExample'], { timeout: 15_000,
        env: { ...process.env, OPEN_PLATFORM_BASE_URL: `http://127.0.0.1:${address.port}/context/`, OPEN_PLATFORM_KEY_ID: keyId,
          OPEN_PLATFORM_SIGNING_SECRET: secret.toString('base64url'), OPEN_PLATFORM_TENANT_ID: 'tenant-1', OPEN_PLATFORM_EMPLOYEE_NO: employeeNo } });
      expect(result.stdout + result.stderr).not.toContain(secret.toString('base64url'));
      expect(result.stdout + result.stderr).not.toContain('NOT_FOR_LOGS');
    }
    expect(received).toEqual(Array.from({ length: 3 }, () => ({ path: '/context/api/sign/orders/v01/query', body: stringifyJson(document.requestExample, 2), valid: true })));
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 25_000);

test.skipIf(!javaAvailable)('OkHttp 示例用真实 JDK8 编译并请求本地 HTTP，保留方法、正文和 contextPath；不跟随重定向或重试错误', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'open-platform-okhttp-'));
  const requests: { method: string | undefined; path: string; authorization: string | undefined; contentType: string | undefined; body: string }[] = [];
  let status = 200;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ method: request.method, path: request.url!, authorization: request.headers.authorization, contentType: request.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(status, { 'Content-Type': 'application/json', ...(status === 302 ? { Location: '/should-not-follow' } : {}), ...(status === 503 ? { 'Retry-After': '0' } : {}) });
    response.end('{"code":200,"data":{"sensitiveBusinessValue":"NOT_FOR_LOGS"}}');
  });
  try {
    const sample = { ...document, path: '/orders/query', httpMethod: 'PATCH' };
    writeFileSync(join(directory, 'ApiExample.java'), okhttpJavaExample(sample));
    execFileSync(javac, ['-encoding', 'UTF-8', '-cp', join(javaDependencies, '*'), join(directory, 'ApiExample.java')]);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('本地测试服务未启动');
    for (const responseStatus of [200, 302, 500, 503]) {
      status = responseStatus;
      const env = { ...process.env, OPEN_PLATFORM_BASE_URL: `http://127.0.0.1:${address.port}/context/`, OPEN_PLATFORM_TOKEN: 'ENV_ONLY_TOKEN' };
      const result = await promisify(execFile)(java, ['-cp', directory + delimiter + join(javaDependencies, '*'), 'ApiExample'], { env, timeout: 15_000 })
        .then(output => ({ ...output, failed: false }), (error: { stdout: string; stderr: string }) => ({ ...error, failed: true }));
      expect(result.failed).toBe(responseStatus !== 200);
      expect(result.stdout + result.stderr).not.toContain('ENV_ONLY_TOKEN');
      expect(result.stdout + result.stderr).not.toContain('NOT_FOR_LOGS');
      expect(requests).toHaveLength([200, 302, 500, 503].indexOf(responseStatus) + 1);
    }
    expect(requests).toEqual(Array.from({ length: 4 }, () => ({ method: 'PATCH', path: '/context/orders/query', authorization: 'Bearer ENV_ONLY_TOKEN', contentType: 'application/json; charset=utf-8', body: stringifyJson(document.requestExample, 2) })));
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);

test('新增语言保留 JSON 正文、运行条件及安全调用选项', () => {
  const javascript = javascriptExample(document);
  const python = pythonExample(document);
  const php = phpExample(document);
  for (const code of [javascript, python, php]) {
    expect(code).toContain(document.path);
    expect(code).toContain('OPEN_PLATFORM_TOKEN');
    expect(code).toContain('application/json');
    expect(code).not.toContain('application/x-www-form-urlencoded');
    expect(code).not.toContain('OPEN_PLATFORM_SIGNING_SECRET');
    expect(code).toContain('9007199254740993');
    expect(code).toContain('0.123456789012345678901');
  }
  expect(javascript).toContain('AbortSignal.timeout(10_000)');
  expect(javascript).toContain('redirect: "error"');
  expect(python).toContain('timeout=10');
  expect(python).toContain('connection.close()');
  expect(php).toContain('CURLOPT_TIMEOUT => 10');
  expect(php).toContain('CURLOPT_FOLLOWLOCATION => false');
  expect(php).toContain('curl_close($client)');
});

const runtimes = [
  { name: 'JavaScript', command: process.execPath, args: ['-e'], generate: javascriptExample, available: true },
  { name: 'Python', command: 'python3', args: ['-c'], generate: pythonExample, available: spawnSync('python3', ['--version']).status === 0 },
  { name: 'PHP', command: 'php', args: ['-r'], generate: (value: ApiDocument) => phpExample(value).replace(/^<\?php\n/, ''), available: spawnSync('php', ['-r', 'exit(extension_loaded("curl") ? 0 : 1);']).status === 0 },
];

for (const runtime of runtimes) {
  test.skipIf(!runtime.available)(`${runtime.name} 生成代码真实请求本地服务，保留正文和 contextPath；重定向和错误不重试`, async () => {
    const requests: { path: string; authorization: string | undefined; contentType: string | undefined; body: string }[] = [];
    let status = 200;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ path: request.url!, authorization: request.headers.authorization, contentType: request.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(status, { 'Content-Type': 'application/json', ...(status === 302 ? { Location: '/should-not-follow' } : {}) });
      response.end('{"code":200,"data":{"sensitiveBusinessValue":"NOT_FOR_LOGS"}}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('本地测试服务未启动');
    try {
      for (const responseStatus of [200, 302, 500]) {
        status = responseStatus;
        const env = { ...process.env, OPEN_PLATFORM_BASE_URL: `http://127.0.0.1:${address.port}/context/`, OPEN_PLATFORM_TOKEN: 'ENV_ONLY_TOKEN' };
        const result = await promisify(execFile)(runtime.command, [...runtime.args, runtime.generate(document)], { env, timeout: 15_000 })
          .then(output => ({ ...output, failed: false }), (error: { stdout: string; stderr: string }) => ({ ...error, failed: true }));
        expect(result.failed).toBe(responseStatus !== 200);
        expect(result.stdout + result.stderr).not.toContain('ENV_ONLY_TOKEN');
        expect(result.stdout + result.stderr).not.toContain('NOT_FOR_LOGS');
        expect(requests).toHaveLength([200, 302, 500].indexOf(responseStatus) + 1);
      }
      expect(requests).toEqual(Array.from({ length: 3 }, () => ({ path: '/context' + document.path, authorization: 'Bearer ENV_ONLY_TOKEN', contentType: 'application/json', body: stringifyJson(document.requestExample, 2) })));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 20_000);
}

test('configured gateway address is ready to use in generated examples', () => {
  const configured = { ...document, baseUrl: 'https://openapi.example.test/gateway' };
  expect(curlExample(configured)).toContain('https://openapi.example.test/gateway');
  expect(javascriptExample(configured)).toContain('const baseUrl = "https://openapi.example.test/gateway"');
  expect(pythonExample(configured)).toContain('base_url = "https://openapi.example.test/gateway"');
  expect(phpExample(configured)).toContain('https://openapi.example.test/gateway');
  expect(okhttpJavaExample(configured)).toContain('https://openapi.example.test/gateway');
});
