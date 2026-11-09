#!/usr/bin/env bash
# Install the canonical-state retention job without changing access or runtime.
set -euo pipefail
[[ $EUID == 0 && $# == 1 && $1 =~ ^(devapp|cn|us)$ ]] || exit 2
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Validate the real host and deletion plan before changing the scheduled entry.
python3 "$source_dir/unified-image-retention.py" "$1"
install -o root -g root -m 0755 "$source_dir/unified-image-retention.py" /usr/local/sbin/workspacex-unified-image-retention.py
mkdir -p /etc/systemd/system/workspacex-image-retention.service.d
cat > /etc/systemd/system/workspacex-image-retention.service.d/canonical.conf <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/python3 /usr/local/sbin/workspacex-unified-image-retention.py $1 --apply
EOF
systemctl daemon-reload
systemctl enable --now workspacex-image-retention.timer
