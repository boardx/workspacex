#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
release_lock
[[ -f $US_STATE/bootstrap-complete ]] || exit 2
origin=$(python3 -c 'import json;print("https://"+json.load(open("/etc/workspacex-us/settings.json"))["domain"])')
curl --fail --silent --show-error "$origin/api/healthz" | python3 -c 'import json,sys;assert json.load(sys.stdin)["trustworthy"] is True'
/usr/local/bin/workspacex-us-business-probe
python3 "$HERE/seal-policy.py"
echo 'API/business acceptance passed; complete docs/ACCEPTANCE.md browser and recovery checks before production handover.'
