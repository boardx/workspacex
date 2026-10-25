#!/usr/bin/env bash
# A one-hour registration token FILE, not a PAT, is passed as the only argument.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
[[ $# == 1 && -f $1 ]] || { echo 'Usage: sudo bash 50-runner.sh /root/runner-registration-token';exit 2; }
mapfile -t values < <(python3 - <<'JSON'
import json
s=json.load(open('/etc/workspacex-us/settings.json'))
for key in ['runnerUser','runnerName','runnerArchiveUrl','runnerArchiveSha256','repository']:print(s[key])
JSON
)
user=${values[0]};name=${values[1]};url=${values[2]};sha=${values[3]};repo=${values[4]}
[[ ! -e /opt/workspacex-us-runner ]] || { echo 'Runner directory exists; inspect before reinstall';exit 2; }
[[ $(stat -c '%u:%a' "$1") == 0:600 ]] || { echo 'Token file must be root:root 0600';exit 2; }
stage=$(mktemp -d);trap 'rm -rf "$stage"' EXIT
curl --fail --silent --show-error --location "$url" -o "$stage/runner.tar.gz"
printf '%s  %s\n' "$sha" "$stage/runner.tar.gz" | sha256sum -c -
install -d -o "$user" -g "$user" -m 0755 /opt/workspacex-us-runner
install -o "$user" -g "$user" -m 0600 "$stage/runner.tar.gz" /opt/workspacex-us-runner/runner.tar.gz
runuser -u "$user" -- tar -xzf /opt/workspacex-us-runner/runner.tar.gz -C /opt/workspacex-us-runner
(cd /opt/workspacex-us-runner && ./bin/installdependencies.sh)
token=$(cat "$1")
(cd /opt/workspacex-us-runner && runuser -u "$user" -- ./config.sh --unattended --url "https://github.com/$repo" --token "$token" --name "$name" --labels workspacex-us-production --work _work)
unset token
rm -- "$1"
(cd /opt/workspacex-us-runner && ./svc.sh install "$user" && ./svc.sh start)
# Needed by the workflow's superseded-source check only for automatic deploys; US is manual.
echo 'Runner installed without docker-group membership; only fixed release entry has sudo permission.'
