#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh";require_root
[[ $# == 2 && -f $1 && -f $2 ]] || { echo 'Usage: sudo bash 30-ingress.sh /root/fullchain.pem /root/private-key.pem';exit 2; }
[[ ! -e /etc/nginx/conf.d/workspacex-selfhost.conf ]] || { echo 'US ingress exists; refuse overwrite';exit 2; }
install -d -m 0700 "$APP_RUNTIME/tls"
install -m 0644 "$1" "$APP_RUNTIME/tls/fullchain.pem"
install -m 0600 "$2" "$APP_RUNTIME/tls/private-key.pem"
domain=$(python3 -c 'import json;print(json.load(open("/etc/workspacex-selfhost/settings.json"))["domain"])')
openssl x509 -in "$1" -noout -checkhost "$domain"
openssl x509 -in "$1" -noout -checkend 86400
cert_pub=$(openssl x509 -in "$1" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
key_pub=$(openssl pkey -in "$2" -pubout -outform DER | sha256sum)
[[ $cert_pub == "$key_pub" ]] || { echo 'Certificate/key mismatch';exit 2; }
install -m 0644 "$APP_RUNTIME/nginx.conf" /etc/nginx/conf.d/workspacex-selfhost.conf
if ! nginx -t;then rm /etc/nginx/conf.d/workspacex-selfhost.conf;exit 1;fi
systemctl reload nginx
