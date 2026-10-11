#!/usr/bin/env python3
"""在独立本机环境创建并调用第一个示例API；仅使用正式HTTP接口，不修改SQL或业务代码。"""
import argparse
import getpass
import http.cookiejar
import json
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.local/state/demo/first-api.json'

class Client:
    def __init__(self, origin):
        self.origin = origin
        self.csrf = None
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, body=None, method=None, bearer=None):
        headers = {'Content-Type': 'application/json'}
        if self.csrf and path.startswith(('/auth/', '/admin-api/', '/portal-api/')):
            headers['X-CSRF-Token'] = self.csrf
        if bearer:
            headers['Authorization'] = 'Bearer ' + bearer
        request = urllib.request.Request(self.origin + path, method=method or ('POST' if body is not None else 'GET'),
            headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            with self.http.open(request, timeout=20) as response:
                if response.headers.get('X-CSRF-Token'):
                    self.csrf = response.headers['X-CSRF-Token']
                return json.load(response)['data']
        except urllib.error.HTTPError as error:
            try:
                failure = json.load(error)
                detail = f"{failure.get('resultMsg', '')}；requestId={failure.get('requestId', '')}"
            except (ValueError, KeyError):
                detail = '请检查平台日志'
            raise RuntimeError(f'{path}: HTTP {error.code}，{detail}') from None

    def login(self, username, password):
        self.csrf = self.request('/auth/csrf')['token']
        self.request('/auth/login', {'username': username, 'password': password})
        self.csrf = None
        return self.request('/admin-api/session')


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')


def check(client, state):
    credentials = state['credentials']
    token = client.request('/api/token', {'appKey': credentials['application']['appKey'], 'appSecret': credentials['appSecret'],
        'tenantId': state['tenantId'], 'existingToken': state.get('accessToken')})
    state['accessToken'] = token['accessToken']
    save(state)
    result = client.request('/api/oauth/demo_orders/v1/query', {'orderNo': 'COMMON-001'}, bearer=token['accessToken'])
    if result.get('orderNo') != 'COMMON-001' or result.get('tenantId') != state['tenantId'] or result.get('amount') != 101.25:
        raise RuntimeError('返回数据与示例不符，请检查Provider租户配置')
    state['verified'] = True
    save(state)
    print('调用成功：' + json.dumps(result, ensure_ascii=False))
    print('AppSecret与Token仅保存在 .local/state/demo/first-api.json，请勿提交或截图。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:18080')
    parser.add_argument('--username', default='admin')
    parser.add_argument('--password-file', type=Path, help='自动化时从文件读取管理员密码；默认交互输入')
    parser.add_argument('--check', action='store_true', help='只使用既有演示凭据重新调用，不创建分类/API/授权')
    parser.add_argument('--resume', action='store_true', help='确认服务端状态后，继续本机状态文件记录的未完成示例')
    args = parser.parse_args()
    parsed = urllib.parse.urlparse(args.base_url)
    if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or parsed.path or parsed.query or parsed.fragment or parsed.username:
        parser.error('演示只支持回环HTTP origin，不用于远程或生产环境')
    client = Client(args.base_url)
    if args.check:
        if not STATE.is_file():
            parser.error('尚无演示状态，请先创建示例')
        state = json.loads(STATE.read_text())
        if state['baseUrl'] != args.base_url or 'credentials' not in state:
            parser.error('状态不完整或属于其他地址；请按文档核对已创建资源，不要删除状态后盲目重跑')
        check(client, state)
        return
    if STATE.exists() and not args.resume:
        parser.error('已有演示状态；正常复验使用 --check，失败恢复见 docs/first-api.md')
    if args.resume and not STATE.exists():
        parser.error('没有可恢复的演示状态')
    password = args.password_file.read_text().rstrip('\r\n') if args.password_file else getpass.getpass('平台管理员密码：')
    session = client.login(args.username, password)
    required = {'MANAGE_APIS', 'MANAGE_APPLICATIONS', 'PUBLISH_APIS', 'REVIEW_APIS'}
    if not required.issubset(session['permissions']):
        parser.error('该示例要求当前账号具备API、凭据管理、发布与审核权限')
    state = json.loads(STATE.read_text()) if STATE.exists() else {'baseUrl': args.base_url, 'tenantId': session['tenantId']}
    if state['baseUrl'] != args.base_url or state['tenantId'] != session['tenantId']:
        parser.error('状态文件所属地址或租户与当前会话不一致')
    if not args.resume:
        # 最多各读取一页；重名资源由使用者判断，不自动接管。
        for path, key, expected in [('/admin-api/scopes?query=demo.orders.read', 'code', 'demo.orders.read'),
                                    ('/admin-api/apis?query=demo_orders', 'service', 'demo_orders')]:
            if any(item.get(key) == expected for item in client.request(path)['items']):
                parser.error('已有同名演示资源，请检查原状态，不自动接管')
    save(state)
    def remember(key, action):
        if key not in state:
            state[key] = action()
            save(state)
        return state[key]
    scope = remember('scope', lambda: client.request('/admin-api/scopes', {'code': 'demo.orders.read', 'name': '示例订单查询',
        'enabled': True, 'defaultForNewApplication': False, 'publicAccess': False}))
    remember('tenantScope', lambda: client.request(f"/admin-api/scopes/{scope['id']}/tenant-grants", {'tenantId': state['tenantId']}))
    category = remember('category', lambda: client.request('/admin-api/api-categories', {'name': '入门示例'}))
    owner = client.request('/admin-api/apis/owners/current')
    definition = json.loads((ROOT / 'examples/first-api/order-query.json').read_text())
    definition['category'] = category['name']
    definition['owner'] = owner['id']
    api = remember('api', lambda: client.request('/admin-api/apis', definition))
    publication_state = client.request(f"/admin-api/publications/apis/{api['id']}/state")
    release = remember('release', lambda: client.request(f"/admin-api/publications/apis/{api['id']}/submissions", {
        'expectedDraftRevision': api['draftRevision'], 'expectedStateVersion': publication_state['stateVersion'],
        'submissionKey': str(uuid.uuid4()), 'comment': '发布本机入门示例'}))
    if release['status'] == 'PENDING':
        release = client.request(f"/admin-api/publications/{release['id']}/approve", {'comment': '确认示例服务与文档'})
        state['release'] = release
        save(state)
    if release['status'] != 'APPLIED':
        raise RuntimeError('发布未生效，请在审核中心查看结果')
    client.request(f"/admin-api/apis/{api['id']}/portal-visibility", {'visible': True}, method='PUT')
    credentials = remember('credentials', lambda: client.request('/admin-api/applications', {'ownerTenantId': state['tenantId'], 'scopeCodes': ['demo.orders.read']}))
    remember('tenantGrant', lambda: client.request('/admin-api/tenant-grants', {'appKey': credentials['application']['appKey'],
        'appSecret': credentials['appSecret'], 'tenantId': state['tenantId']}))
    print('示例API已发布，API ID：' + api['id'])
    check(client, state)
    client.request('/auth/logout', {})

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, urllib.error.URLError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
