"""公开安装材料回归；不连接服务，不接触使用者已有配置。"""
import contextlib
import hashlib
import io
from pathlib import Path
import runpy
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
EXPORT = runpy.run_path(str(ROOT / 'scripts/export-init-sql.py'))


class BootstrapTest(unittest.TestCase):
    def test_public_sql_is_current_and_includes_copy_requests(self):
        sql, count = EXPORT['render'](ROOT)
        self.assertEqual((ROOT / 'sql/init.sql').read_text(), sql)
        self.assertEqual(44, count)
        self.assertIn('CREATE TABLE IF NOT EXISTS catalog_api_copy_request', sql)
        self.assertIn("VALUES ('local-admin','local','local-admin'", sql)

    def test_omitted_schema_is_rejected(self):
        render = EXPORT['render']
        schemas = tuple(name for name in EXPORT['SCHEMAS'] if name != 'api-copy')
        with patch.dict(render.__globals__, SCHEMAS=schemas):
            with self.assertRaisesRegex(ValueError, 'api-copy-schema.sql'):
                render(ROOT)

    def test_fresh_setup_creates_own_credentials_without_private_sql(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'sql').mkdir()
            shutil.copyfile(ROOT / 'sql/init.sql', root / 'sql/init.sql')
            sql_before = (root / 'sql/init.sql').read_bytes()
            password = 'demo-only-' + __import__('secrets').token_urlsafe(20)
            password_file = root / 'password.txt'
            password_file.write_text(password)
            main = runpy.run_path(str(ROOT / 'scripts/setup-local.py'))['main']
            with patch.dict(main.__globals__, ROOT=root), patch.object(sys, 'argv', ['setup-local.py', '--password-file', str(password_file)]):
                with contextlib.redirect_stdout(io.StringIO()):
                    main()
                config = root / 'config/local/private/application.properties'
                properties = dict(line.split('=', 1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
                digest = bytes.fromhex(properties['open-platform.accounts.users[0].password-hash'])
                self.assertEqual(digest[16:], hashlib.pbkdf2_hmac('sha256', password.encode(), digest[:16], 310000))
                self.assertNotIn(password, config.read_text())
                env = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines())
                self.assertEqual(env['MYSQL_PASSWORD'], properties['spring.datasource.password'])
                self.assertTrue((root / 'config/local/private/provider-public.pem').is_file())
                self.assertFalse((root / '.local').exists())
                self.assertEqual(sql_before, (root / 'sql/init.sql').read_bytes())
                before = {p: p.read_bytes() for p in root.rglob('*') if p.is_file()}
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    main()
                self.assertEqual(before, {p: p.read_bytes() for p in root.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
