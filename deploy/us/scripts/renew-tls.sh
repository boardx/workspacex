#!/usr/bin/env bash
# Certbot deploy hook, installed after first certificate acceptance.
set -euo pipefail
[[ $EUID == 0 ]] || exit 2
runtime=/etc/workspacex-us
domain=$(python3 -c 'import json;print(json.load(open("/etc/workspacex-us/settings.json"))["domain"])')
lineage="/etc/letsencrypt/live/$domain"
[[ ${RENEWED_LINEAGE:-$lineage} == "$lineage" ]] || exit 0
openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost "$domain"
openssl x509 -in "$lineage/fullchain.pem" -noout -checkend 86400
cert=$(openssl x509 -in "$lineage/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
key=$(openssl pkey -in "$lineage/privkey.pem" -pubout -outform DER | sha256sum)
[[ $cert == "$key" ]] || exit 2
cp -p "$runtime/tls/fullchain.pem" "$runtime/tls/fullchain.previous.pem"
cp -p "$runtime/tls/private-key.pem" "$runtime/tls/private-key.previous.pem"
install -m 0644 "$lineage/fullchain.pem" "$runtime/tls/fullchain.pem"
install -m 0600 "$lineage/privkey.pem" "$runtime/tls/private-key.pem"
if ! nginx -t;then
 mv "$runtime/tls/fullchain.previous.pem" "$runtime/tls/fullchain.pem"
 mv "$runtime/tls/private-key.previous.pem" "$runtime/tls/private-key.pem"
 exit 1
fi
systemctl reload nginx
