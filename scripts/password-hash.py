#!/usr/bin/env python3
"""生成与本地账号适配器一致的PBKDF2密码摘要。"""
import getpass
import hashlib
import secrets
password = getpass.getpass("密码（至少12字符）：")
if not 12 <= len(password) <= 256:
    raise SystemExit("密码长度应为12到256字符")
salt = secrets.token_bytes(16)
print((salt + hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310000)).hex())
