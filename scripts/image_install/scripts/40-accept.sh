#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
release_lock
[[ -f $APP_STATE/bootstrap-complete ]] || exit 2
origin=$(python3 -c 'import json;print("https://"+json.load(open("/etc/workspacex-selfhost/settings.json"))["domain"])')
ready=false
for i in {1..60};do
 if curl --max-time 5 --fail --silent "$origin/api/healthz" | python3 -c 'import json,sys;assert json.load(sys.stdin)["trustworthy"] is True' 2>/dev/null;then ready=true;break;fi
 sleep 2
done
[[ $ready == true ]] || { echo 'Public HTTPS health did not become trustworthy';exit 1; }
umask 077
/usr/local/bin/workspacex-selfhost-business-probe > "$APP_STATE/business-probe.json"
touch "$APP_STATE/accepted"
echo 'Public health and login/file/Agent/model/sandbox probes passed. Complete browser acceptance in README.'
