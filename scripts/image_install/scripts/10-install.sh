#!/usr/bin/env bash
# Inputs must be a reviewed, root-owned kit and private generated configuration.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh"
require_root
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]] || { echo 'Requires Ubuntu 24.04 x86_64';exit 2; }
docker compose run --help | grep -q -- '--env-from-file' || { echo 'Compose run --env-from-file is required';exit 2; }
aa-enabled --quiet || { echo 'AppArmor is not enabled';exit 2; }
[[ $# == 2 && $2 == --new-install ]] || { echo 'Usage: sudo bash 10-install.sh /root/us-private --new-install';exit 2; }
input=$(realpath "$1");kit=$(dirname "$HERE")
[[ ! -e /etc/apparmor.d/workspacex-native-sessions ]] || { echo 'AppArmor profile file exists; inspect ownership before adoption';exit 2; }
if aa-status 2>/dev/null | grep -q workspacex-native-sessions;then echo 'AppArmor profile exists; inspect ownership before adoption';exit 2;fi
[[ ! -e $APP_RUNTIME && ! -e $APP_DATA && ! -e $APP_STATE ]] || { echo 'Existing installation: refuse overwrite';exit 2; }
[[ -f $kit/SHA256SUMS ]] || { echo 'Use package.py output, not the source directory';exit 2; }
(cd "$kit" && sha256sum --quiet -c SHA256SUMS)
python3 - "$kit" "$input" <<'CHECK'
import json,os,stat,sys
from pathlib import Path
for root in map(Path,sys.argv[1:]):
 for p in [*reversed(root.parents),root,*root.rglob('*')]:
  s=p.lstat()
  if p.is_symlink() or s.st_uid!=0 or s.st_mode & 0o022:raise SystemExit('Untrusted root-owned input: '+str(p))
c=json.loads((Path(sys.argv[2])/'settings.json').read_text())
if 'REPLACE_' in json.dumps(c):raise SystemExit('Unfilled settings')
CHECK
install -d -m 0700 "$APP_RUNTIME" "$APP_DATA" "$APP_STATE"
for f in "$input"/*;do [[ -f $f ]] && install -o root -g root -m 0600 "$f" "$APP_RUNTIME/";done
install -m 0644 "$kit/templates/docker-seccomp.json" "$APP_RUNTIME/docker-seccomp.json"
install -m 0644 "$kit/templates/docker-apparmor-sessions" "$APP_RUNTIME/docker-apparmor-sessions"
for d in sandbox sessions;do install -d -o 1000 -g 1000 -m 0700 "$APP_RUNTIME/$d";done
for d in certs agent-certs;do install -d -m 0755 "$APP_RUNTIME/$d";done
install -d -o 1000 -g 1000 -m 0700 "$APP_DATA/objects"
install -d -m 0700 "$APP_DATA/postgres" "$APP_DATA/redis" "$APP_DATA/backups"
install -d -m 0755 /usr/local/lib/workspacex-selfhost
for f in common.sh business-probe.sh backup.sh;do install -m 0755 "$HERE/$f" "/usr/local/lib/workspacex-selfhost/$f";done
install -m 0755 "$HERE/business-probe.sh" /usr/local/bin/workspacex-selfhost-business-probe
release_lock
# /run is volatile: recreate the same canonical lock after reboot.
printf 'f /run/workspacex-selfhost-deploy.lock 0600 root root -\n' > /etc/tmpfiles.d/workspacex-selfhost.conf
# Persist the profile and order Docker after AppArmor for reliable reboot recovery.
install -o root -g root -m 0644 "$APP_RUNTIME/docker-apparmor-sessions" /etc/apparmor.d/workspacex-native-sessions
apparmor_parser -r /etc/apparmor.d/workspacex-native-sessions
install -d -m 0755 /etc/systemd/system/docker.service.d
printf '[Unit]\nRequires=apparmor.service\nAfter=apparmor.service\n' > /etc/systemd/system/docker.service.d/workspacex-selfhost-apparmor.conf
systemctl daemon-reload
echo 'Runtime installed; proceed to database initialization.'
