#!/usr/bin/env bash
# Explicit first install only. Runs database DDL and creates the initial admin.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
[[ $# == 1 && $1 == --initialize-empty-us ]] || { echo 'Usage: sudo bash 20-bootstrap.sh --initialize-empty-us';exit 2; }
release_lock
[[ ! -e $US_STATE/bootstrap-complete && ! -e $US_STATE/bootstrap-started ]] || { echo 'Bootstrap already attempted; inspect state, do not blindly retry';exit 2; }
# Credentials are consumed by Compose only here; no write credential is required.
export DOCKER_CONFIG=$US_DOCKER_CONFIG
compose config --quiet
compose pull
python3 - <<'CHECK'
import json,subprocess
from pathlib import Path
s=json.loads(Path('/etc/workspacex-us/settings.json').read_text())
for line in Path('/etc/workspacex-us/compose.env').read_text().splitlines():
 k,image=line.split('=',1)
 v=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]
 if v['Os']!='linux' or v['Architecture']!='amd64':raise SystemExit('Image platform mismatch')
 if k not in ('REDIS_IMAGE','POSTGRES_IMAGE') and v.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')!=s['sourceRevision']:raise SystemExit('Image source mismatch')
CHECK
# Refuse to initialize directories containing foreign database data.
[[ -z $(find "$US_DATA/postgres" "$US_DATA/redis" -mindepth 1 -print -quit) ]] || { echo 'Data directories not empty';exit 2; }
touch "$US_STATE/bootstrap-started"
pg_image=$(sed -n 's/^POSTGRES_IMAGE=//p' "$US_RUNTIME/compose.env")
redis_image=$(sed -n 's/^REDIS_IMAGE=//p' "$US_RUNTIME/compose.env")
pg_uid=$(docker run --rm --network none --entrypoint id "$pg_image" -u postgres)
redis_uid=$(docker run --rm --network none --entrypoint id "$redis_image" -u redis)
[[ $pg_uid =~ ^[0-9]+$ && $redis_uid =~ ^[0-9]+$ ]] || exit 2
chown "$pg_uid:$pg_uid" "$US_DATA/postgres"
chown "$redis_uid:$redis_uid" "$US_DATA/redis" "$US_RUNTIME/redis.conf"
compose up -d --no-build --pull never postgres redis
ready=false
for i in {1..60};do if compose exec -T postgres pg_isready -U postgres >/dev/null;then ready=true;break;fi;sleep 2;done
[[ $ready == true ]] || { echo 'Postgres not ready';exit 1; }
api_job() { compose run --rm --no-deps --env-from-file "$US_RUNTIME/$1.env" --entrypoint node api --import tsx "$2"; }
api_job migration scripts/prepare-starter-roles.ts
api_job migration src/infrastructure/db/migrate-cli.ts
compose run --rm --no-deps --env-from-file "$US_RUNTIME/memory-migration.env" --entrypoint python agent -m deep_agent_service.memory_deployment prepare
api_job bootstrap scripts/provision-admin.ts > "$US_STATE/bootstrap-admin.json"
chmod 0600 "$US_STATE/bootstrap-admin.json"
python3 - <<'UPDATE'
import json
from pathlib import Path
p=Path('/etc/workspacex-us/probe.env');a=json.loads(Path('/var/lib/workspacex-image-release/us/bootstrap-admin.json').read_text().splitlines()[-1])
assert a['ok'] is True
p.write_text(p.read_text().replace('FILL_FROM_BOOTSTRAP',a['orgId'],1).replace('FILL_FROM_BOOTSTRAP',a['defaultAgentId'],1))
UPDATE
compose up -d --no-build --pull never
# DNS/TLS are installed next. This marker proves bootstrap, not public acceptance.
touch "$US_STATE/bootstrap-complete"
echo 'Initialized. Install TLS/Nginx, then run 40-accept.sh.'
