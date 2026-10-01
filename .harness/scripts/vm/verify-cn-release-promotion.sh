#!/usr/bin/env bash
# Root-only, read-only admission gate used immediately before GitHub advances
# main-cn. The GitHub token deliberately remains in the unprivileged workflow.
set -euo pipefail

[[ $# -eq 3 && "$1" =~ ^[a-f0-9]{40}$ && "$2" =~ ^[a-f0-9]{40}$ && "$3" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]] || {
  echo "usage: workspacex-cn-verify-promotion <40-hex-revision> <40-hex-expected-main-cn> <attempt-id>" >&2
  exit 2
}
[[ ${EUID} -eq 0 ]] || { echo "CN_PROMOTION_VERIFY_REQUIRES_ROOT" >&2; exit 1; }

revision=$1
expected_main_cn=$2
attempt_id=$3
REPOSITORY_DIR=/opt/workspacex-cn/repository
RELEASES_DIR=/etc/workspacex-cn/releases
RUNTIME_ROOT=/var/lib/workspacex-cn/runtime
RELEASE_TREE_ROOT=/var/lib/workspacex-cn/releases
PREFLIGHT_VERIFIER=/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh
NGINX_CONFIG=/etc/nginx/conf.d/workspacex-cn.conf

manifest="$RELEASES_DIR/$revision.json"
seal="$RELEASES_DIR/$revision.sealed.json"
runtime="$RUNTIME_ROOT/$revision"
release_checkout="$RELEASE_TREE_ROOT/$revision"
prepare_receipt="$runtime/prepare-receipt.json"
fast_safe_receipt="$runtime/fast-safe-release.json"

fail() { echo "CN_PROMOTION_VERIFY_REJECTED: $1" >&2; exit 1; }
pnpm() { COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 "$@"; }
protected_file() {
  local path=$1
  [[ -f "$path" && ! -L "$path" ]] || fail "protected preparation evidence is missing"
  [[ "$(stat -c '%U:%G:%a' "$path")" == root:root:600 ]] || fail "protected preparation evidence permissions differ"
}
capture_baseline() {
  local output=$1 api=workspacex-cn-api-1 web=workspacex-cn-web-1 agent=workspacex-cn-agent-1 sandbox=workspacex-cn-sandbox-1
  local api_image web_image agent_image sandbox_image config_file nginx_hash
  for container in "$api" "$web" "$agent" "$sandbox"; do
    docker inspect "$container" >/dev/null 2>&1 || fail "baseline container is unavailable"
  done
  api_image=$(docker inspect --format '{{.Image}}' "$api")
  web_image=$(docker inspect --format '{{.Image}}' "$web")
  agent_image=$(docker inspect --format '{{.Image}}' "$agent")
  sandbox_image=$(docker inspect --format '{{.Image}}' "$sandbox")
  config_file=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$api")
  [[ "$config_file" == "$RUNTIME_ROOT"/*/compose.json ]] || fail "baseline runtime is untrusted"
  [[ -f "$NGINX_CONFIG" && ! -L "$NGINX_CONFIG" ]] || fail "baseline nginx configuration is unavailable"
  nginx_hash=$(sha256sum "$NGINX_CONFIG" | cut -d' ' -f1)
  node - "$output" "$config_file" "$api_image" "$web_image" "$agent_image" "$sandbox_image" "$nginx_hash" <<'NODE'
const fs=require("node:fs");
const [path,composeFile,api,web,agent,sandbox,nginxSha256]=process.argv.slice(2);
fs.writeFileSync(path,`${JSON.stringify({schemaVersion:1,composeFile,images:{api,web,agent,sandbox},nginxSha256})}\n`,{mode:0o600,flag:"wx"});
NODE
}

[[ -d "$REPOSITORY_DIR/.git" ]] || fail "release repository is unavailable"
[[ -x "$PREFLIGHT_VERIFIER" && ! -L "$PREFLIGHT_VERIFIER" ]] || fail "trusted preflight verifier is unavailable"
[[ -f "$manifest" && ! -L "$manifest" && -f "$seal" && ! -L "$seal" ]] || fail "candidate manifest or seal is unavailable"

git -C "$REPOSITORY_DIR" cat-file -e "$revision^{commit}" 2>/dev/null || fail "revision is unavailable"
git -C "$REPOSITORY_DIR" merge-base --is-ancestor "$revision" origin/main || fail "revision is not contained in origin/main"
current_main_cn=$(git -C "$REPOSITORY_DIR" rev-parse origin/main-cn)
if [[ "$current_main_cn" != "$expected_main_cn" && "$current_main_cn" != "$revision" ]]; then
  fail "main-cn compare-and-swap baseline changed"
fi
if [[ "$expected_main_cn" != "$revision" ]]; then
  git -C "$REPOSITORY_DIR" merge-base --is-ancestor "$expected_main_cn" "$revision" \
    || fail "revision is not a fast-forward of expected main-cn"
fi

node - "$manifest" "$seal" "$revision" <<'NODE' || fail "candidate manifest or seal validation failed"
const fs=require("node:fs"),crypto=require("node:crypto"),[manifestPath,sealPath,revision]=process.argv.slice(2);
const bytes=fs.readFileSync(manifestPath),manifest=JSON.parse(bytes),seal=JSON.parse(fs.readFileSync(sealPath,"utf8"));
const digest=crypto.createHash("sha256").update(bytes).digest("hex");
if(manifest.sourceRevision!==revision||seal.schemaVersion!==1||seal.status!=="sealed"||seal.sourceRevision!==revision||seal.manifestSha256!==digest||Number.isNaN(Date.parse(seal.sealedAt)))process.exit(1);
NODE

if [[ ! -e "$runtime" && ! -e "$release_checkout" ]]; then
  echo "CN_PROMOTION_NOT_PREPARED revision=$revision" >&2
  exit 3
fi
[[ -d "$release_checkout/.git" ]] || fail "prepared release checkout is missing"
[[ "$(git -C "$release_checkout" rev-parse HEAD)" == "$revision" ]] || fail "prepared checkout revision differs"
[[ -z "$(git -C "$release_checkout" status --porcelain)" ]] || fail "prepared checkout is dirty"
protected_file "$prepare_receipt"
protected_file "$fast_safe_receipt"
node - "$prepare_receipt" <<'NODE' || fail "prepare receipt is incomplete"
const fs=require("node:fs"),v=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(v.schemaVersion!==1||v.status!=="files-ready-ingress-installation-required"||v.profileManaged!==true||v.releaseTreeVerified!==true)process.exit(1);
NODE

exec 9>"$RUNTIME_ROOT/release.lock"
chown root:root "$RUNTIME_ROOT/release.lock"; chmod 0600 "$RUNTIME_ROOT/release.lock"
flock -n 9 || fail "another release operation is active"
release=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.release)' "$manifest")
(cd "$release_checkout"; node --import tsx packages/cloud-deploy/src/cn-candidate-config-cli.ts verify "$revision" "$release" "$attempt_id") >/dev/null || fail "candidate configuration receipt rejected"
"$PREFLIGHT_VERIFIER" preactivate "$revision" "$release" "$attempt_id" >/dev/null \
  || fail "preactivate receipt is missing, changed, or expired"

current_dir=$(mktemp -d "$runtime/.promotion-baseline.XXXXXX")
trap 'rm -rf -- "$current_dir"' EXIT
current_baseline="$current_dir/baseline.json"
capture_baseline "$current_baseline"
baseline_sha=$(pnpm --dir "$release_checkout" --filter @repo/cloud-deploy cn-fast-safe-release fingerprint "$current_baseline" "$NGINX_CONFIG")
pnpm --dir "$release_checkout" --filter @repo/cloud-deploy cn-fast-safe-release validate \
  "$fast_safe_receipt" "$revision" "$baseline_sha" "$manifest" >/dev/null \
  || fail "prepared receipt, baseline, or manifest differs"

branch_state=expected
[[ "$current_main_cn" == "$revision" ]] && branch_state=already-promoted
printf 'CN_PROMOTION_READY revision=%s expected_main_cn=%s branch_state=%s\n' "$revision" "$expected_main_cn" "$branch_state"
