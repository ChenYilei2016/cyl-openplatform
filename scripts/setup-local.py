#!/usr/bin/env python3
"""初始化本项目自己的本机配置；不覆盖已有配置或访问数据库。"""
import argparse
import getpass
import hashlib
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = (
    "access", "mcp", "catalog", "dubbo-connection", "token", "publication", "governance",
    "observability", "operations-metrics", "environment-release-transfer", "environment-release-receipt",
    "sdk-asset", "operations-alert", "signature", "administrator",
)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--password-file", type=Path, help="从文件读取初始管理员密码，适合自动化；默认交互输入")
    args = parser.parse_args()
    private = ROOT / "config/local/private/application.properties"
    env = ROOT / ".env"
    sql = ROOT / ".local/init/01-platform.sql"
    for path in (private, env, sql):
        if path.exists():
            parser.error(f"已有文件 {path.relative_to(ROOT)}，为保留现有账号与数据，本工具不覆盖")
    password = args.password_file.read_text().rstrip("\r\n") if args.password_file else getpass.getpass("初始 admin 密码（至少12字符）：")
    if len(password) < 12 or len(password) > 256:
        parser.error("密码长度应为12到256字符")
    if not args.password_file and password != getpass.getpass("再次输入密码："):
        parser.error("两次密码不一致")
    salt = secrets.token_bytes(16)
    password_hash = (salt + hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310000)).hex()
    key = subprocess.check_output(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"], stderr=subprocess.DEVNULL).decode()
    public_key = subprocess.check_output(["openssl", "pkey", "-pubout"], input=key.encode(), stderr=subprocess.DEVNULL).decode()
    db_password = secrets.token_urlsafe(32)
    root_password = secrets.token_urlsafe(32)
    content = f"""# 本机运行配置，由 setup-local.py 生成，已被 Git 忽略。
spring.datasource.url=jdbc:mysql://127.0.0.1:13306/cyl_openplatform
spring.datasource.username=cyl
spring.datasource.password={db_password}
spring.data.redis.port=16379
open-platform.gateway.provider.key-id=local-platform
open-platform.gateway.provider.private-key={key.replace(chr(10), chr(92)+'n')}
open-platform.accounts.users[0].username=admin
open-platform.accounts.users[0].password-hash={password_hash}
open-platform.accounts.users[0].tenant-id=local
open-platform.accounts.users[0].tenant-name=本地租户
open-platform.accounts.users[0].user-id=local-admin
open-platform.accounts.users[0].employee-id=local-admin
open-platform.accounts.users[0].employee-no=admin
open-platform.accounts.users[0].display-name=管理员
open-platform.accounts.users[0].enabled=true
"""
    # Java Properties 使用 Unicode 转义，避免租户/人员名称按 ISO-8859-1 读取成乱码。
    content = "\n".join(line if line.startswith("#") else "".join(
        character if ord(character) < 128 else "\\u%04x" % ord(character)
        for character in line) for line in content.split("\n"))
    schema_root = ROOT / "cyl-openplatform-infrastructure/src/main/resources/db"
    schema = "\n".join((schema_root / f"{name}-schema.sql").read_text() for name in SCHEMAS)
    schema += """
-- 仅用于全新独立数据库的首位管理员，不适用于现有数据库升级。
INSERT INTO platform_administrator (id,tenant_id,user_id,employee_id,employee_no,display_name,enabled,super_administrator,revision)
VALUES ('local-admin','local','local-admin','local-admin','admin','管理员',true,true,1);
"""
    for permission in ("MANAGE_APPLICATIONS", "MANAGE_APIS", "MANAGE_CONNECTIONS", "PUBLISH_APIS", "REVIEW_APIS", "MANAGE_OPERATIONS", "VIEW_AUDIT"):
        schema += f"INSERT INTO platform_administrator_permission VALUES ('local-admin','{permission}');\n"
    for path, value in ((private, content), (env, f"MYSQL_PASSWORD={db_password}\nMYSQL_ROOT_PASSWORD={root_password}\n"), (sql, schema)):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x") as output:
            output.write(value)
    (private.parent / "provider-public.pem").write_text(public_key)
    print("已生成本机配置、独立数据库初始化SQL与Provider公钥。")
    print("下一步：docker compose up -d，然后 bash scripts/build.sh 和 bash scripts/run-local.sh")
    print("账号：admin；密码为刚才输入的值。数据库端口13306，Redis端口16379。")

if __name__ == "__main__":
    main()
