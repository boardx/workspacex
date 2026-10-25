#!/usr/bin/env bash
# Brief downtime. Logical snapshots plus objects/config; Redis contains transient state.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
[[ $# == 1 && $1 == --brief-downtime ]] || { echo 'Usage: sudo bash backup.sh --brief-downtime';exit 2; }
release_lock
[[ -f $APP_STATE/bootstrap-complete ]] || exit 2
umask 077
out="$APP_DATA/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$out"
mapfile -t running < <(compose ps --status running --services | grep -E '^(api|web|agent|sandbox|sandbox-sessions)$')
[[ ${#running[@]} == 5 ]] || { echo 'All application services must be running';exit 2; }
trap 'compose start "${running[@]}"' EXIT
compose stop "${running[@]}"
for db in workspacex workspacex_agent workspacex_memory;do
 compose exec -T postgres pg_dump -U postgres -Fc "$db" > "$out/$db.dump"
done
tar -czf "$out/objects.tar.gz" -C "$APP_DATA" objects
# Running immutable digests, not stale initial tags, are the restore baseline.
python3 - "$out" <<'META'
import json,subprocess,sys
from pathlib import Path
root=Path('/etc/workspacex-selfhost');entries={};sources=[]
for service in ['api','web','agent','sandbox','postgres','redis']:
 cid=subprocess.check_output(['docker','compose','-p','workspacex-selfhost','--env-file',str(root/'compose.env'),'-f',str(root/'compose.json'),'ps','-aq',service],text=True).strip()
 container=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
 image=json.loads(subprocess.check_output(['docker','image','inspect',container['Image']]))[0]
 digests=image.get('RepoDigests',[])
 if not digests:raise SystemExit('Image has no repository digest; backup is incomplete')
 entries[service.upper()+'_IMAGE']=digests[0]
 if service!='redis':sources.append(image['Config']['Labels']['org.opencontainers.image.revision'])
if len(set(sources[:4]))!=1:raise SystemExit('Mixed application source revisions')
# Postgres may intentionally remain on a previous source; preserve its own exact digest.
meta={'sourceRevision':sources[0],'images':entries}
Path(sys.argv[1],'images.json').write_text(json.dumps(meta,indent=2)+'\n')
META
tar -czf "$out/runtime.tar.gz" -C "$APP_RUNTIME" --exclude='./sandbox' --exclude='./sessions' --exclude='./certs' --exclude='./agent-certs' .
(cd "$out" && sha256sum *.dump *.tar.gz images.json > SHA256SUMS)
echo "Private backup: $out ; transfer off-host. No cross-host or restore verification claimed."
