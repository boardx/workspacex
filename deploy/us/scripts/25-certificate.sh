#!/usr/bin/env bash
# Optional ACME certificate issuance. Requires public DNS and inbound port 80.
set -euo pipefail
[[ $EUID == 0 && $# == 1 && $1 == --issue-public-certificate ]] || { echo 'Usage: sudo bash 25-certificate.sh --issue-public-certificate';exit 2; }
mapfile -t values < <(python3 - <<'JSON'
import json
s=json.load(open('/etc/workspacex-us/settings.json'));print(s['domain']);print(s['adminEmail'])
JSON
)
apt-get install -y certbot
# Standalone validation briefly stops this fresh host's ingress. No other sites may share it.
systemctl stop nginx
trap 'systemctl start nginx' EXIT
certbot certonly --standalone --non-interactive --agree-tos --email "${values[1]}" -d "${values[0]}"
echo "Certificate: /etc/letsencrypt/live/${values[0]}/fullchain.pem ; key: privkey.pem"
echo 'Renew using the standalone hooks documented in RUNBOOK.md; copied runtime files also need renewal.'
