#!/usr/bin/env python3
"""检查开源源码布局、文档链接与脚本语法；不连接服务、不修改文件。"""
import argparse
import ast
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
IGNORED = {'.git', '.local', 'node_modules', 'target', 'dist', '__pycache__'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--syntax', action='store_true')
    args = parser.parse_args()
    failures = []
    files = []
    for directory, dirs, names in __import__('os').walk(ROOT):
        dirs[:] = [name for name in dirs if name not in IGNORED and Path(directory, name) != ROOT / 'config/local/private']
        files.extend(Path(directory, name) for name in names if not name.startswith('.env'))
    for path in files:
        rel = path.relative_to(ROOT)
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        try:
            if path.suffix == '.java':
                package = re.search(r'^package ([\w.]+);', text, re.M)
                if package and not str(path.parent).endswith(package[1].replace('.', '/')):
                    failures.append(f'{rel}: 包名与目录不一致')
            if path.suffix == '.md':
                links = re.findall(r'\]\(([^)]+)\)', text)
                links += re.findall(r'(?:href|src)=["\']([^"\']+)["\']', text)
                for link in links:
                    target = link.split('#', 1)[0]
                    if not target or re.match(r'[\w+.-]+:', target):
                        continue
                    if not (path.parent / target).exists():
                        failures.append(f'{rel}: 链接不存在 {target}')
            if args.syntax:
                if path.suffix == '.py':
                    ast.parse(text)
                elif path.suffix == '.sh':
                    subprocess.run(['bash', '-n', str(path)], check=True, capture_output=True)
                elif path.name == 'pom.xml' or path.suffix == '.xml':
                    ET.fromstring(text)
                elif path.suffix == '.json' and not path.name.startswith('tsconfig'):
                    json.loads(text)
        except Exception as error:
            failures.append(f'{rel}: {type(error).__name__}: {error}')
    sql_check = subprocess.run([sys.executable, str(ROOT / 'scripts/export-init-sql.py'), '--check'],
                               capture_output=True, text=True)
    if sql_check.returncode:
        failures.append(sql_check.stderr.strip() or sql_check.stdout.strip())
    if failures:
        print('\n'.join(failures))
        return 1
    print(f'布局、链接与请求的语法检查通过（{len(files)}个文件）。')
    return 0

if __name__ == '__main__':
    sys.exit(main())
