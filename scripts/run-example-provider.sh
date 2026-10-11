#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
python3 - <<'PY'
from pathlib import Path
import os
public_key = Path(os.environ.get('DEMO_PUBLIC_KEY_FILE', 'config/local/private/provider-public.pem'))
if not public_key.is_file():
    raise SystemExit('缺少Provider公钥；请先执行 scripts/setup-local.py 或设置 DEMO_PUBLIC_KEY_FILE')
path = Path('.local/runtime/order-provider.properties')
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text('open-platform.provider.environment-id=' + os.environ.get('OPEN_PLATFORM_ENVIRONMENT_ID', 'local') + '\n'
    + 'open-platform.provider.public-keys.local-platform=' + public_key.read_text().strip().replace('\n', '\\n') + '\n'
    + 'example.order.data.primary-tenant-id=' + os.environ.get('DEMO_TENANT_ID', 'local') + '\n'
    + 'example.order.data.primary-employee-no=admin\n')
PY
exec java -jar examples/order-provider/target/example-order-provider-exec.jar \
  --spring.config.additional-location=file:./.local/runtime/order-provider.properties "$@"
