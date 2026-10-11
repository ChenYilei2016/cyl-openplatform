#!/usr/bin/env python3
"""从当前Schema生成公开初始化SQL；--check核对文件同步及持久化表覆盖，不连接数据库。"""
import argparse
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = (
    'access', 'mcp', 'catalog', 'api-copy', 'dubbo-connection', 'token', 'publication',
    'governance', 'observability', 'operations-metrics', 'environment-release-transfer',
    'environment-release-receipt', 'sdk-asset', 'operations-alert', 'signature', 'administrator',
)
TABLE = re.compile(r'CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)', re.I)
TABLE_PREFIXES = ('access_', 'mcp_', 'catalog_', 'dubbo_', 'platform_', 'publication_',
                  'gateway_', 'environment_', 'token_', 'sdk_')


def render(root):
    source_dir = root / 'cyl-openplatform-infrastructure/src/main/resources/db'
    sources = [source_dir / (name + '-schema.sql') for name in SCHEMAS]
    current = {p for p in source_dir.glob('*-schema.sql') if not p.name.startswith('upgrade-')}
    missing = current - set(sources)
    if missing:
        raise ValueError('初始化清单遗漏当前Schema：' + ', '.join(sorted(p.name for p in missing)))
    header = '''-- CYL Open Platform：全新MySQL 8.4空库初始化（表结构 + 首位管理员资格）。
-- 不包含登录密码、数据库账号密码、Provider密钥或演示API。
-- 先选择已创建的空库；Compose自动选择cyl_openplatform。不可用于现有库升级。
-- 由 scripts/export-init-sql.py 生成；修改分模块Schema或bootstrap-admin.sql后重新生成。
SET NAMES utf8mb4;

'''
    parts = []
    for path in sources + [root / 'sql/bootstrap-admin.sql']:
        parts.append('-- Source: ' + path.relative_to(root).as_posix() + '\n' + path.read_text().rstrip() + '\n')
    text = header + '\n'.join(parts)
    names = TABLE.findall(text)
    if len(names) != len(set(names)):
        raise ValueError('初始化SQL存在重复建表，请检查Schema归属')
    declared = set(names)
    referenced = set()
    for path in (root / 'cyl-openplatform-infrastructure/src/main').rglob('*'):
        if path.suffix not in {'.java', '.xml'}:
            continue
        source = path.read_text()
        referenced.update(re.findall(r'@TableName\("(\w+)"\)', source))
        for name in re.findall(r'\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z][a-z0-9_]*)', source, re.I):
            if name.startswith(TABLE_PREFIXES):
                referenced.add(name)
    if referenced - declared:
        raise ValueError('持久化代码引用了未建表的对象：' + ', '.join(sorted(referenced - declared)))
    return text, len(names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        text, count = render(ROOT)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    target = ROOT / 'sql/init.sql'
    if args.check:
        if not target.exists() or target.read_text() != text:
            parser.error('sql/init.sql与源文件不一致；请运行 python3 scripts/export-init-sql.py')
        print(f'初始化SQL完整性通过：{len(SCHEMAS)}份当前Schema，{count}张表，含首位管理员资格。')
    else:
        target.write_text(text)
        print(f'已生成 sql/init.sql：{count}张表。')

if __name__ == '__main__':
    main()
