#!/usr/bin/env bash
# One-time bootstrap for the isolated China production ECS. Safe to invoke through
# Aliyun Cloud Assistant as root after the repository and host dependencies exist.
set -euo pipefail

[[ $# -eq 0 ]] || { echo "usage: bootstrap-cn-production.sh" >&2; exit 2; }
[[ ${EUID} -eq 0 ]] || { echo "CN_BOOTSTRAP_REQUIRES_ROOT" >&2; exit 1; }

REPOSITORY_DIR=${REPOSITORY_DIR:-/opt/workspacex-cn/repository}
RUNNER_USER=${RUNNER_USER:-ghrunner}
TRUSTED_DEPLOY_BIN=${TRUSTED_DEPLOY_BIN:-/usr/local/bin/workspacex-cn-deploy}
SUDOERS_FILE=${SUDOERS_FILE:-/etc/sudoers.d/workspacex-cn-deploy}

[[ "$REPOSITORY_DIR" == /* && "$TRUSTED_DEPLOY_BIN" == /* && "$SUDOERS_FILE" == /* ]] || {
  echo "CN_BOOTSTRAP_PATHS_MUST_BE_ABSOLUTE" >&2; exit 1;
}
[[ "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "CN_BOOTSTRAP_INVALID_RUNNER_USER" >&2; exit 1; }
id "$RUNNER_USER" >/dev/null 2>&1 || { echo "CN_BOOTSTRAP_RUNNER_USER_MISSING" >&2; exit 1; }
RUNNER_GROUP=$(id -gn "$RUNNER_USER")
[[ -d "$REPOSITORY_DIR/.git" ]] || { echo "CN_BOOTSTRAP_REPOSITORY_MISSING" >&2; exit 1; }

for command in git node pnpm docker apparmor_parser nginx aliyun flock visudo runuser systemctl stat; do
  command -v "$command" >/dev/null 2>&1 || { echo "CN_BOOTSTRAP_DEPENDENCY_MISSING: $command" >&2; exit 1; }
done
[[ "$(node --version)" == v22.* ]] || { echo "CN_BOOTSTRAP_NODE_22_REQUIRED" >&2; exit 1; }
compose_version=$(docker compose version --short 2>/dev/null || true)
[[ "$compose_version" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+) ]] || { echo "CN_BOOTSTRAP_COMPOSE_VERSION_INVALID" >&2; exit 1; }
(( 10#${BASH_REMATCH[1]} > 2 || 10#${BASH_REMATCH[1]} == 2 && 10#${BASH_REMATCH[2]} >= 30 )) || {
  echo "CN_BOOTSTRAP_COMPOSE_2_30_REQUIRED" >&2; exit 1;
}
[[ "$(cat /sys/module/apparmor/parameters/enabled 2>/dev/null)" == Y ]] || { echo "CN_BOOTSTRAP_APPARMOR_REQUIRED" >&2; exit 1; }

source_script="$REPOSITORY_DIR/.harness/scripts/vm/deploy-cn-production.sh"
[[ -f "$source_script" && ! -L "$source_script" ]] || { echo "CN_BOOTSTRAP_DEPLOY_SOURCE_MISSING" >&2; exit 1; }

install -d -o root -g "$RUNNER_GROUP" -m 0750 /etc/workspacex-cn /etc/workspacex-cn/releases
install -d -o root -g root -m 0700 /etc/workspacex-cn/requests
install -d -o "$RUNNER_USER" -g "$RUNNER_GROUP" -m 0755 /opt/workspacex-cn
install -d -o root -g root -m 0700 /var/lib/workspacex-cn /var/lib/workspacex-cn/runtime /var/lib/workspacex-cn/releases
printf '%s\n' "$RUNNER_USER" > /etc/workspacex-cn/runner-user
chown root:root /etc/workspacex-cn/runner-user
chmod 0600 /etc/workspacex-cn/runner-user
install -o root -g root -m 0755 "$source_script" "$TRUSTED_DEPLOY_BIN"

sudoers_temp=$(mktemp)
trap 'rm -f "$sudoers_temp"' EXIT
printf '%s ALL=(root) NOPASSWD: %s *\n' "$RUNNER_USER" "$TRUSTED_DEPLOY_BIN" > "$sudoers_temp"
chmod 0440 "$sudoers_temp"
visudo -cf "$sudoers_temp" >/dev/null
install -o root -g root -m 0440 "$sudoers_temp" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

printf 'CN_PRODUCTION_BOOTSTRAPPED repository=%s runner=%s\n' "$REPOSITORY_DIR" "$RUNNER_USER"
