#!/usr/bin/env bash
# Install reviewed release tooling on one Linux host; does not switch runtimes.
set -euo pipefail
[[ $EUID == 0 && $# == 1 ]] || { echo 'Usage: sudo bash scripts/install-image-release.sh <runner-user>' >&2; exit 2; }
runner_user=$1
[[ "$runner_user" =~ ^[a-z_][a-z0-9_-]*$ ]] && id "$runner_user" >/dev/null
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
files=(deploy-registry-images.py registry-images.py minimal-docker-release.py hosted-release.py canonical_control.py)
# Content-address the full Python closure so an in-flight deployment never imports a mixed installation.
release_hash=$(cd "$source_dir" && sha256sum "${files[@]}" | sha256sum | cut -d' ' -f1)
target="/usr/local/lib/workspacex-image-release/$release_hash"
install -d -o root -g root -m 0755 /usr/local/lib/workspacex-image-release
if [[ ! -d "$target" ]]; then
  stage=$(mktemp -d /usr/local/lib/workspacex-image-release/.install.XXXXXX)
  trap 'rm -rf -- "${stage:-}"' EXIT
  for file in "${files[@]}"; do install -o root -g root -m 0644 "$source_dir/$file" "$stage/$file"; done
  chmod 0755 "$stage"
  mv -- "$stage" "$target"
  stage=''
fi
wrapper=$(mktemp /usr/local/bin/.workspacex-image-release.XXXXXX)
trap 'rm -f -- "${wrapper:-}"' EXIT
cat > "$wrapper" <<WRAPPER
#!/bin/sh
exec /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B '$target/deploy-registry-images.py' "\$@"
WRAPPER
chown root:root "$wrapper"; chmod 0755 "$wrapper"
mv -- "$wrapper" /usr/local/bin/workspacex-image-release
wrapper=''
# The helper validates environment and immutable tag; it never accepts arbitrary config/commands.
sudo_file=$(mktemp /etc/sudoers.d/.workspacex-image-release.XXXXXX)
trap 'rm -f -- "${sudo_file:-}"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/local/bin/workspacex-image-release devapp *, /usr/local/bin/workspacex-image-release cn *\n' "$runner_user" > "$sudo_file"
chmod 0440 "$sudo_file"
visudo -cf "$sudo_file" >/dev/null
mv -- "$sudo_file" /etc/sudoers.d/workspacex-image-release
sudo_file=''
printf 'Installed release tooling %s; runtime and cutover unchanged.\n' "$release_hash"
