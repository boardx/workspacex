#!/usr/bin/env bash
# Explicit first install only. Runs database DDL and creates the initial admin.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
[[ $# == 1 && $1 == --initialize-empty-instance ]] || { echo 'Usage: sudo bash 20-bootstrap.sh --initialize-empty-instance';exit 2; }
release_lock
[[ ! -e $APP_STATE/bootstrap-complete && ! -e $APP_STATE/bootstrap-started ]] || { echo 'Bootstrap already attempted; inspect state, do not blindly retry';exit 2; }
# Credentials are consumed by Compose only here; no write credential is required.
compose config --quiet
python3 - <<'CHECK'
import json,subprocess
from pathlib import Path
s=json.loads(Path('/etc/workspacex-selfhost/settings.json').read_text())
for line in Path('/etc/workspacex-selfhost/compose.env').read_text().splitlines():
 k,image=line.split('=',1)
 v=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]
 if v['Os']!='linux' or v['Architecture']!='amd64':raise SystemExit('Image platform mismatch')
 if k not in ('REDIS_IMAGE','POSTGRES_IMAGE') and v.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')!=s['sourceRevision']:raise SystemExit('Image source mismatch')
CHECK
# Refuse to initialize directories containing foreign database data.
[[ -z $(find "$APP_DATA/postgres" "$APP_DATA/redis" -mindepth 1 -print -quit) ]] || { echo 'Data directories not empty';exit 2; }
touch "$APP_STATE/bootstrap-started"
pg_image=$(sed -n 's/^POSTGRES_IMAGE=//p' "$APP_RUNTIME/compose.env")
redis_image=$(sed -n 's/^REDIS_IMAGE=//p' "$APP_RUNTIME/compose.env")
pg_uid=$(docker run --rm --network none --entrypoint id "$pg_image" -u postgres)
redis_uid=$(docker run --rm --network none --entrypoint id "$redis_image" -u redis)
[[ $pg_uid =~ ^[0-9]+$ && $redis_uid =~ ^[0-9]+$ ]] || exit 2
chown "$pg_uid:$pg_uid" "$APP_DATA/postgres"
chown "$redis_uid:$redis_uid" "$APP_DATA/redis" "$APP_RUNTIME/redis.conf"
compose up -d --no-build --pull never postgres redis
ready=false
for i in {1..60};do if compose exec -T postgres pg_isready -U postgres >/dev/null;then ready=true;break;fi;sleep 2;done
[[ $ready == true ]] || { echo 'Postgres not ready';exit 1; }
api_job() { compose run --rm --no-deps --env-from-file "$APP_RUNTIME/$1.env" --entrypoint node api --import tsx "$2"; }
api_job migration scripts/prepare-starter-roles.ts
api_job migration src/infrastructure/db/migrate-cli.ts
compose run --rm --no-deps --env-from-file "$APP_RUNTIME/memory-migration.env" --entrypoint python agent -m deep_agent_service.memory_deployment prepare
api_job bootstrap scripts/provision-admin.ts > "$APP_STATE/bootstrap-admin.json"
chmod 0600 "$APP_STATE/bootstrap-admin.json"
python3 - <<'UPDATE'
import json
from pathlib import Path
p=Path('/etc/workspacex-selfhost/probe.env');a=json.loads(Path('/var/lib/workspacex-selfhost-state/bootstrap-admin.json').read_text().splitlines()[-1])
assert a['ok'] is True
p.write_text(p.read_text().replace('FILL_FROM_BOOTSTRAP',a['orgId'],1).replace('FILL_FROM_BOOTSTRAP',a['defaultAgentId'],1))
UPDATE
compose up -d --no-build --pull never
# DNS/TLS are installed next. This marker proves bootstrap, not public acceptance.
touch "$APP_STATE/bootstrap-complete"
echo 'Initialized. Install TLS/Nginx, then run 40-accept.sh.'
