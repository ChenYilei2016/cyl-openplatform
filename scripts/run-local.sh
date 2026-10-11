#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
exec java -jar cyl-openplatform-server/target/cyl-openplatform-server.jar "$@"
