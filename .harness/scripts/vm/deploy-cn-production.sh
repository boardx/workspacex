#!/usr/bin/env bash
# Trusted root entrypoint used by deploy-cn-production.yml.
set -euo pipefail

mode=deploy
if [[ ${1:-} == --prepare ]]; then mode=prepare; shift; fi
[[ $# -eq 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo "usage: workspacex-cn-deploy [--prepare] <40-hex-revision>" >&2; exit 2; }
[[ ${EUID} -eq 0 ]] || { echo "CN_DEPLOY_REQUIRES_ROOT" >&2; exit 1; }
revision=$1

REPOSITORY_DIR=/opt/workspacex-cn/repository
CONFIG_FILE=/etc/workspacex-cn/deployment.json
RELEASES_DIR=/etc/workspacex-cn/releases
REQUESTS_DIR=/etc/workspacex-cn/requests
RUNTIME_ROOT=/var/lib/workspacex-cn/runtime
RELEASE_TREE_ROOT=/var/lib/workspacex-cn/releases
AGENT_ENV_FILE=/etc/workspacex-cn/agent.env
RUNNER_ID_FILE=/etc/workspacex-cn/runner-user
NGINX_CONFIG=/etc/nginx/conf.d/workspacex-cn.conf
PROJECT_NAME=workspacex-cn
manifest="$RELEASES_DIR/$revision.json"
runtime="$RUNTIME_ROOT/$revision"
release_checkout="$RELEASE_TREE_ROOT/$revision"
request="$REQUESTS_DIR/$revision.json"

fail() { echo "CN_DEPLOY_REJECTED: $1" >&2; exit 1; }
private_root_file() {
  local path=$1
  [[ -f "$path" && ! -L "$path" ]] || fail "protected file missing: $path"
  [[ "$(stat -c '%U:%G:%a' "$path")" == root:root:600 ]] || fail "protected file must be root:root 0600: $path"
}
runner_readable_manifest() {
  local path=$1
  [[ -f "$path" && ! -L "$path" ]] || fail "release manifest missing: $path"
  [[ "$(stat -c '%U:%G:%a' "$path")" == "root:$REPOSITORY_GROUP:640" ]] || fail "release manifest must be root:$REPOSITORY_GROUP 0640: $path"
}

private_root_file "$RUNNER_ID_FILE"
REPOSITORY_USER=$(cat "$RUNNER_ID_FILE")
[[ "$REPOSITORY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "invalid repository user"
id "$REPOSITORY_USER" >/dev/null 2>&1 || fail "repository user missing"
REPOSITORY_GROUP=$(id -gn "$REPOSITORY_USER")
[[ -d "$REPOSITORY_DIR/.git" ]] || fail "repository missing"
private_root_file "$CONFIG_FILE"
runner_readable_manifest "$manifest"
private_root_file "$AGENT_ENV_FILE"
install -d -o root -g root -m 0700 "$REQUESTS_DIR" "$RUNTIME_ROOT"
install -d -o root -g root -m 0700 "$RELEASE_TREE_ROOT"

exec 9>"$RUNTIME_ROOT/deploy.lock"
flock -n 9 || fail "another deployment is active"

git -C "$REPOSITORY_DIR" cat-file -e "$revision^{commit}" 2>/dev/null || fail "revision is unavailable"
git -C "$REPOSITORY_DIR" merge-base --is-ancestor "$revision" origin/main || fail "revision is not contained in origin/main"

node -e '
  const fs=require("node:fs");
  const [path,revision]=process.argv.slice(1);
  const value=JSON.parse(fs.readFileSync(path,"utf8"));
  if(value.sourceRevision!==revision)process.exit(1);
' "$manifest" "$revision" || fail "manifest sourceRevision mismatch"

if [[ "$mode" == prepare ]]; then
  [[ ! -e "$release_checkout" && ! -e "$runtime" ]] || fail "release preparation already exists"
  stage=$(mktemp -d "$RELEASE_TREE_ROOT/.prepare-$revision.XXXXXX")
  cleanup_stage() { rm -rf -- "$stage"; }
  trap cleanup_stage EXIT
  # --no-local prevents hardlinks to runner-owned object files. The resulting Git
  # database and worktree are created by root and are independently trustable.
  git clone --quiet --no-local --no-checkout "$REPOSITORY_DIR" "$stage/checkout"
  git -C "$stage/checkout" checkout --quiet --detach "$revision"
  [[ "$(git -C "$stage/checkout" rev-parse HEAD)" == "$revision" ]] || fail "prepared checkout revision mismatch"
  [[ -z "$(git -C "$stage/checkout" status --porcelain)" ]] || fail "prepared checkout is dirty"
  # Dependencies belong to the pre-provision preparation window. Copying package
  # files avoids runner-owned pnpm-store hardlinks in the trusted release tree.
  pnpm --dir "$stage/checkout" install --frozen-lockfile --ignore-scripts --package-import-method=copy
  chmod -R go-w "$stage/checkout"
  mv "$stage/checkout" "$release_checkout"
  rmdir "$stage"
  trap - EXIT
  cd "$release_checkout"
  pnpm --filter @repo/cloud-deploy prepare-host -- "$CONFIG_FILE" "$manifest" "$release_checkout" "$runtime"
  [[ -f "$runtime/prepare-receipt.json" ]] || fail "prepare receipt missing"
  printf 'CN_PRODUCTION_RELEASE_PREPARED revision=%s\n' "$revision"
  exit 0
fi

[[ "$(git -C "$REPOSITORY_DIR" rev-parse origin/main-cn)" == "$revision" ]] || fail "revision is not origin/main-cn tip"
[[ -d "$release_checkout/.git" && -f "$runtime/prepare-receipt.json" ]] || fail "release is not prewarmed; run --prepare before promotion"
[[ "$(git -C "$release_checkout" rev-parse HEAD)" == "$revision" ]] || fail "prepared checkout revision mismatch"
[[ -z "$(git -C "$release_checkout" status --porcelain)" ]] || fail "prepared checkout is dirty"

cd "$release_checkout"

nginx_source="$runtime/nginx.conf"
[[ -f "$nginx_source" && ! -L "$nginx_source" ]] || fail "prepared nginx configuration missing"
nginx_backup=""
if [[ -e "$NGINX_CONFIG" ]]; then
  [[ -f "$NGINX_CONFIG" && ! -L "$NGINX_CONFIG" ]] || fail "existing nginx configuration is unsafe"
  nginx_backup=$(mktemp "${NGINX_CONFIG}.backup.XXXXXX")
  cp --preserve=mode,ownership,timestamps "$NGINX_CONFIG" "$nginx_backup"
fi
install -o root -g root -m 0600 "$nginx_source" "$NGINX_CONFIG"
if ! nginx -t; then
  if [[ -n "$nginx_backup" ]]; then mv -f "$nginx_backup" "$NGINX_CONFIG"; else rm -f "$NGINX_CONFIG"; fi
  fail "nginx configuration rejected and rolled back"
fi
rm -f "$nginx_backup"
systemctl reload nginx

umask 077
node -e '
  const fs=require("node:fs");
  const [path,config,release,runtime,agent,project]=process.argv.slice(1);
  const value={configFile:config,releaseFile:release,options:{projectName:project,runtimeDirectory:runtime,agentEnvironmentSecretRef:`file:${agent}`}};
  fs.writeFileSync(path,`${JSON.stringify(value)}\n`,{mode:0o600});
' "$request" "$CONFIG_FILE" "$manifest" "$runtime" "$AGENT_ENV_FILE" "$PROJECT_NAME"
chown root:root "$request"
chmod 0600 "$request"

pnpm --filter @repo/cloud-deploy provision -- "$request"
printf 'CN_PRODUCTION_DEPLOYED revision=%s\n' "$revision"
