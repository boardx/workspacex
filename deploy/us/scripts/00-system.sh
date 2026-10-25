#!/usr/bin/env bash
# Fresh Ubuntu only. Does not uninstall conflicting Docker packages or configure a firewall.
set -euo pipefail
[[ $EUID == 0 && $# == 1 && $1 == --fresh-host ]] || { echo 'Usage: sudo bash 00-system.sh --fresh-host'; exit 2; }
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]] || { echo 'Requires Ubuntu 24.04 x86_64'; exit 2; }
if command -v docker >/dev/null; then echo 'Docker exists: refuse fresh-host installer; inspect manually';exit 2;fi
for pkg in docker.io docker-compose docker-compose-v2 podman-docker containerd runc;do
 if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed';then echo "Conflict: $pkg; inspect manually";exit 2;fi
done
apt-get update
apt-get install -y ca-certificates curl python3 nginx apparmor apparmor-utils git jq uidmap openssl
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
systemctl enable --now apparmor
docker version
docker compose version
