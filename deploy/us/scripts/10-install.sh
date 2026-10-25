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
[[ ! -e $US_RUNTIME && ! -e $US_DATA && ! -e $US_STATE ]] || { echo 'Existing installation: refuse overwrite';exit 2; }
[[ -f $kit/SHA256SUMS && -d $kit/tools ]] || { echo 'Use package.py output, not the source directory';exit 2; }
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
install -d -m 0700 "$US_RUNTIME" "$US_DATA" "$US_STATE" /etc/workspacex-image-release "$US_DOCKER_CONFIG"
for f in "$input"/*;do [[ -f $f ]] && install -o root -g root -m 0600 "$f" "$US_RUNTIME/";done
install -m 0644 "$kit/templates/docker-seccomp.json" "$US_RUNTIME/docker-seccomp.json"
install -m 0644 "$kit/templates/docker-apparmor-sessions" "$US_RUNTIME/docker-apparmor-sessions"
for d in sandbox sessions;do install -d -o 1000 -g 1000 -m 0700 "$US_RUNTIME/$d";done
for d in certs agent-certs;do install -d -m 0755 "$US_RUNTIME/$d";done
install -d -o 1000 -g 1000 -m 0700 "$US_DATA/objects"
install -d -m 0700 "$US_DATA/postgres" "$US_DATA/redis" "$US_DATA/backups"
install -d -m 0755 /usr/local/lib/workspacex-us
for f in common.sh business-probe.sh backup.sh;do install -m 0755 "$HERE/$f" "/usr/local/lib/workspacex-us/$f";done
install -m 0755 "$HERE/business-probe.sh" /usr/local/bin/workspacex-us-business-probe
release_lock
# /run is volatile: recreate the same canonical lock after reboot.
printf 'f /run/workspacex-us-deploy.lock 0600 root root -\n' > /etc/tmpfiles.d/workspacex-us.conf
# Persist the profile and order Docker after AppArmor for reliable reboot recovery.
install -o root -g root -m 0644 "$US_RUNTIME/docker-apparmor-sessions" /etc/apparmor.d/workspacex-native-sessions
apparmor_parser -r /etc/apparmor.d/workspacex-native-sessions
install -d -m 0755 /etc/systemd/system/docker.service.d
printf '[Unit]\nRequires=apparmor.service\nAfter=apparmor.service\n' > /etc/systemd/system/docker.service.d/workspacex-us-apparmor.conf
systemctl daemon-reload
runner_user=$(python3 -c 'import json;print(json.load(open("/etc/workspacex-us/settings.json"))["runnerUser"])')
id "$runner_user" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$runner_user"
bash "$kit/tools/install-image-release.sh" "$runner_user"
echo 'Installed. Next configure root-only registry login, then run 20-bootstrap.sh.'
