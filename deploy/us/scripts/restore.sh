#!/usr/bin/env bash
# Run only on a NEW replacement host bootstrapped with prepare-restore.py output.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
[[ $# == 2 && $2 == --replace-fresh-us ]] || { echo 'Usage: sudo bash restore.sh /root/verified-backup --replace-fresh-us';exit 2; }
backup=$(realpath "$1")
release_lock
[[ -f $US_STATE/bootstrap-complete && -f $US_RUNTIME/restore-probe.env && ! -e /etc/workspacex-image-release/us.json ]] || { echo 'Requires unsealed, freshly bootstrapped restore target';exit 2; }
(cd "$backup" && sha256sum -c SHA256SUMS)
python3 - "$backup" <<'CHECK'
import json,sys
from pathlib import Path
r=Path('/etc/workspacex-us');m=json.loads(Path(sys.argv[1],'images.json').read_text())
assert json.loads((r/'settings.json').read_text())['sourceRevision']==m['sourceRevision']
assert dict(v.split('=',1) for v in (r/'compose.env').read_text().splitlines())==m['images']
CHECK
# No restart trap: a partial restore must stay offline for explicit recovery.
compose stop api web agent sandbox sandbox-sessions
for item in 'workspacex:postgres' 'workspacex_agent:agent_server' 'workspacex_memory:memory_owner';do
 db=${item%:*};role=${item#*:}
 compose exec -T postgres pg_restore -U postgres --role "$role" --clean --if-exists --exit-on-error --no-owner -d "$db" < "$backup/$db.dump"
done
python3 - "$backup/objects.tar.gz" "$US_DATA" <<'OBJECTS'
import os,sys,tarfile
from pathlib import Path,PurePosixPath
root=Path(sys.argv[2]);dest=root/'objects'
assert not any(dest.iterdir()),'Restore target object directory is not empty'
with tarfile.open(sys.argv[1],'r:gz') as t:
 for m in t.getmembers():
  p=PurePosixPath(m.name)
  assert p.parts and p.parts[0]=='objects' and not p.is_absolute() and '..' not in p.parts and (m.isdir() or m.isfile())
  out=root/p
  if m.isdir():out.mkdir(mode=0o700,parents=True,exist_ok=True)
  else:
   with out.open('xb') as f:f.write(t.extractfile(m).read())
  os.chown(out,1000,1000)
OBJECTS
install -m 0600 "$US_RUNTIME/restore-probe.env" "$US_RUNTIME/probe.env"
compose start api web agent sandbox sandbox-sessions
echo 'Restored. Run public business/browser checks and 40-accept.sh before switching DNS/traffic.'
