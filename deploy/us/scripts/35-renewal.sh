#!/usr/bin/env bash
# Only for this dedicated single-site host using certbot standalone authentication.
set -euo pipefail
[[ $EUID == 0 && $# == 1 && $1 == --standalone-hooks ]] || { echo 'Usage: sudo bash 35-renewal.sh --standalone-hooks';exit 2; }
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
command -v certbot >/dev/null
for kind in pre post deploy;do
 install -d -m 0755 "/etc/letsencrypt/renewal-hooks/$kind"
 [[ ! -e /etc/letsencrypt/renewal-hooks/$kind/workspacex-us ]] || { echo 'Existing hook: inspect before replacing';exit 2; }
done
printf '#!/bin/sh\nset -eu\nsystemctl stop nginx\n' > /etc/letsencrypt/renewal-hooks/pre/workspacex-us
printf '#!/bin/sh\nset -eu\nsystemctl start nginx\n' > /etc/letsencrypt/renewal-hooks/post/workspacex-us
install -m 0755 "$HERE/renew-tls.sh" /etc/letsencrypt/renewal-hooks/deploy/workspacex-us
chmod 0755 /etc/letsencrypt/renewal-hooks/{pre,post}/workspacex-us
systemctl enable --now certbot.timer
certbot renew --dry-run
# Explicitly exercise deployment of the currently valid live certificate.
bash /etc/letsencrypt/renewal-hooks/deploy/workspacex-us
echo 'Persistent pre/post/deploy hooks installed; timer and dry-run completed.'
