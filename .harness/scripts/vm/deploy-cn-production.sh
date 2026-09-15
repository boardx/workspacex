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
STABLE_SECRET_DIRECTORY=/var/lib/workspacex-cn/stable-secrets
RELEASE_TREE_ROOT=/var/lib/workspacex-cn/releases
EVENTS_ROOT=/var/lib/workspacex-cn/release-events
PREPARATIONS_DIR=/etc/workspacex-cn/preparations
AGENT_ENV_FILE=/etc/workspacex-cn/agent.env
RUNNER_ID_FILE=/etc/workspacex-cn/runner-user
NGINX_CONFIG=/etc/nginx/conf.d/workspacex-cn.conf
PROJECT_NAME=workspacex-cn
manifest="$RELEASES_DIR/$revision.json"
seal="$RELEASES_DIR/$revision.sealed.json"
runtime="$RUNTIME_ROOT/$revision"
release_checkout="$RELEASE_TREE_ROOT/$revision"
request="$REQUESTS_DIR/$revision.json"
preparation_input="$PREPARATIONS_DIR/$revision.json"
fast_safe_receipt="$runtime/fast-safe-release.json"
baseline_state="$runtime/baseline.json"
baseline_nginx="$runtime/baseline-nginx.conf"

fail() { echo "CN_DEPLOY_REJECTED: $1" >&2; exit 1; }
resolve_browser_executable() {
  local candidate path
  for candidate in chromium-browser chromium google-chrome; do
    path=$(command -v "$candidate" 2>/dev/null || true)
    if [[ "$path" == /* && -x "$path" ]]; then printf '%s' "$path"; return 0; fi
  done
  return 1
}
record_event() {
  node - "$EVENTS_ROOT/$revision.jsonl" "$revision" "$1" <<'NODE'
const fs=require("node:fs"),[path,revision,stage]=process.argv.slice(2);
fs.appendFileSync(path,`${JSON.stringify({schemaVersion:1,revision,stage,at:new Date().toISOString()})}\n`,{mode:0o600});
NODE
  chown root:root "$EVENTS_ROOT/$revision.jsonl"; chmod 0600 "$EVENTS_ROOT/$revision.jsonl"
}
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
capture_baseline() {
  local output=$1 api=workspacex-cn-api-1 web=workspacex-cn-web-1 agent=workspacex-cn-agent-1 sandbox=workspacex-cn-sandbox-1
  local api_image web_image agent_image sandbox_image config_file nginx_hash
  for container in "$api" "$web" "$agent" "$sandbox"; do docker inspect "$container" >/dev/null 2>&1 || fail "baseline container missing: $container"; done
  api_image=$(docker inspect --format '{{.Image}}' "$api")
  web_image=$(docker inspect --format '{{.Image}}' "$web")
  agent_image=$(docker inspect --format '{{.Image}}' "$agent")
  sandbox_image=$(docker inspect --format '{{.Image}}' "$sandbox")
  config_file=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$api")
  [[ "$config_file" == "$RUNTIME_ROOT"/*/compose.json ]] || fail "baseline runtime is untrusted"
  nginx_hash=$(sha256sum "$NGINX_CONFIG" | cut -d' ' -f1)
  node - "$output" "$config_file" "$api_image" "$web_image" "$agent_image" "$sandbox_image" "$nginx_hash" <<'NODE'
const fs=require("node:fs");
const [path,composeFile,api,web,agent,sandbox,nginxSha256]=process.argv.slice(2);
const value={schemaVersion:1,composeFile,images:{api,web,agent,sandbox},nginxSha256};
fs.writeFileSync(path,`${JSON.stringify(value)}\n`,{mode:0o600,flag:"wx"});
NODE
  chown root:root "$output"; chmod 0600 "$output"
}
verify_stable_identity() {
  local baseline_file=$1 baseline_runtime baseline_secret_directory legacy_flag=()
  baseline_runtime=$(node -e 'const p=require("node:path");const v=require(process.argv[1]);process.stdout.write(p.dirname(v.composeFile))' "$baseline_file")
  baseline_secret_directory="$baseline_runtime/secrets"
  if [[ -e "$baseline_runtime/stable-secret-directory.ref" ]]; then
    private_root_file "$baseline_runtime/stable-secret-directory.ref"
    baseline_secret_directory=$(tr -d '\n' < "$baseline_runtime/stable-secret-directory.ref")
    [[ "$baseline_secret_directory" == "$STABLE_SECRET_DIRECTORY" ]] || fail "baseline stable secret directory drift"
  else
    [[ "$baseline_runtime" == "$RUNTIME_ROOT"/* && "${baseline_runtime#"$RUNTIME_ROOT"/}" =~ ^[a-f0-9]{40}$ &&
       "$baseline_secret_directory" == "$baseline_runtime/secrets" ]] || fail "legacy baseline secret directory invalid"
    legacy_flag=(--legacy-baseline)
  fi
  pnpm --filter @repo/cloud-deploy stable-secret-preflight "$baseline_secret_directory" "$STABLE_SECRET_DIRECTORY" "${legacy_flag[@]}" >/dev/null || fail "stable secret continuity preflight failed"
}
baseline_fingerprint() {
  pnpm --dir "$release_checkout" --filter @repo/cloud-deploy cn-fast-safe-release fingerprint "$1" "$2"
}
restore_baseline() {
  local rollback_dir override compose_file
  rollback_dir=$(mktemp -d "$runtime/.rollback.XXXXXX")
  override="$rollback_dir/images.json"
  compose_file=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.composeFile)' "$baseline_state")
  node - "$baseline_state" "$override" <<'NODE'
const fs=require("node:fs"),value=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
fs.writeFileSync(process.argv[3],JSON.stringify({services:{api:{image:value.images.api},web:{image:value.images.web},agent:{image:value.images.agent},sandbox:{image:value.images.sandbox}}}),{mode:0o600,flag:"wx"});
NODE
  install -o root -g root -m 0600 "$baseline_nginx" "$NGINX_CONFIG"
  nginx -t && systemctl reload nginx
  docker compose -p "$PROJECT_NAME" -f "$compose_file" -f "$override" up -d --remove-orphans
  rm -rf -- "$rollback_dir"
}
enable_run_drain() {
  local drain_dir candidate
  drain_dir=$(mktemp -d "$runtime/.drain.XXXXXX")
  candidate="$drain_dir/nginx.conf"
  node - "$NGINX_CONFIG" "$candidate" <<'NODE'
const fs=require("node:fs"),source=fs.readFileSync(process.argv[2],"utf8");
let count=0;
const value=source.replace(/(location (?:= \/api\/copilotkit|\^~ \/api\/copilotkit\/) \{\n)/g,match=>{count++;return `${match}        if ($request_method = POST) { return 503; }\n`;});
if(count!==2)process.exit(1);
fs.writeFileSync(process.argv[3],value,{mode:0o600,flag:"wx"});
NODE
  install -o root -g root -m 0600 "$candidate" "$NGINX_CONFIG"
  nginx -t
  systemctl reload nginx
  rm -rf -- "$drain_dir"
}
active_run_counts() {
  docker exec workspacex-cn-api-1 node -e '
const fs=require("node:fs"),{Client}=require("pg");
const ssl=process.env.PGSSLMODE==="disable"?false:{rejectUnauthorized:true,ca:fs.readFileSync(process.env.PGSSLROOTCERT,"utf8")};
const client=new Client({host:process.env.PGHOST,port:Number(process.env.PGPORT),database:process.env.PGDATABASE,user:process.env.DIAG_DB_USER,password:process.env.DIAG_DB_PASSWORD,ssl});
(async()=>{await client.connect();const result=await client.query("SELECT status,count(*)::int AS count FROM agent_runs WHERE status IN ('"'"'queued'"'"','"'"'running'"'"','"'"'writeback_pending'"'"') GROUP BY status");await client.end();const out={queued:0,running:0,writeback_pending:0};for(const row of result.rows)out[row.status]=row.count;process.stdout.write(JSON.stringify(out));})().catch(()=>process.exit(1));'
}
wait_for_run_drain() {
  local counts
  while (( SECONDS < activation_deadline )); do
    counts=$(active_run_counts) || fail "active run drain is unproven"
    node -e 'const v=JSON.parse(process.argv[1]);if(v.queued!==0||v.running!==0||v.writeback_pending!==0)process.exit(1)' "$counts" && return 0
    sleep 2
  done
  fail "active runs did not drain within activation budget"
}

private_root_file "$RUNNER_ID_FILE"
REPOSITORY_USER=$(cat "$RUNNER_ID_FILE")
[[ "$REPOSITORY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "invalid repository user"
id "$REPOSITORY_USER" >/dev/null 2>&1 || fail "repository user missing"
REPOSITORY_GROUP=$(id -gn "$REPOSITORY_USER")
[[ -d "$REPOSITORY_DIR/.git" ]] || fail "repository missing"
private_root_file "$CONFIG_FILE"
runner_readable_manifest "$manifest"
runner_readable_manifest "$seal"
private_root_file "$AGENT_ENV_FILE"
install -d -o root -g root -m 0700 "$REQUESTS_DIR" "$RUNTIME_ROOT" "$PREPARATIONS_DIR" "$EVENTS_ROOT"
install -d -o root -g root -m 0700 "$RELEASE_TREE_ROOT"

exec 9>"$RUNTIME_ROOT/release.lock"
flock -n 9 || fail "another deployment is active"

git -C "$REPOSITORY_DIR" cat-file -e "$revision^{commit}" 2>/dev/null || fail "revision is unavailable"
git -C "$REPOSITORY_DIR" merge-base --is-ancestor "$revision" origin/main || fail "revision is not contained in origin/main"

node -e '
  const fs=require("node:fs");
  const [path,revision]=process.argv.slice(1);
  const value=JSON.parse(fs.readFileSync(path,"utf8"));
  if(value.sourceRevision!==revision)process.exit(1);
' "$manifest" "$revision" || fail "manifest sourceRevision mismatch"
node - "$manifest" "$seal" "$revision" <<'NODE' || fail "release seal validation failed"
const fs=require("node:fs"),crypto=require("node:crypto"),[manifestPath,sealPath,revision]=process.argv.slice(2);
const bytes=fs.readFileSync(manifestPath),manifest=JSON.parse(bytes),seal=JSON.parse(fs.readFileSync(sealPath,"utf8"));
const digest=crypto.createHash("sha256").update(bytes).digest("hex");
if(manifest.sourceRevision!==revision||seal.schemaVersion!==1||seal.status!=="sealed"||seal.sourceRevision!==revision||seal.manifestSha256!==digest||Number.isNaN(Date.parse(seal.sealedAt)))process.exit(1);
NODE

if [[ "$mode" == prepare ]]; then
  record_event prepare_started
  private_root_file "$preparation_input"
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
  # Prove module resolution plus the Chromium executable and system libraries while
  # preparation is still side-effect free, before an activation can change ingress.
  browser_executable=$(resolve_browser_executable) || fail "browser executable missing"
  CN_BROWSER_EXECUTABLE_PATH="$browser_executable" \
    node .harness/scripts/vm/cn-release-browser-smoke.mjs --preflight >/dev/null \
    || fail "browser runtime preflight failed"
  pnpm --filter @repo/cloud-deploy prepare-host "$CONFIG_FILE" "$manifest" "$release_checkout" "$runtime"
  [[ -f "$runtime/prepare-receipt.json" ]] || fail "prepare receipt missing"
  [[ -f "$NGINX_CONFIG" && ! -L "$NGINX_CONFIG" ]] || fail "baseline nginx configuration missing"
  install -o root -g root -m 0600 "$NGINX_CONFIG" "$baseline_nginx"
  capture_baseline "$baseline_state"
  verify_stable_identity "$baseline_state"
  baseline_sha=$(baseline_fingerprint "$baseline_state" "$baseline_nginx")
  pnpm --filter @repo/cloud-deploy cn-fast-safe-release bind "$preparation_input" "$baseline_sha" "$fast_safe_receipt" >/dev/null
  pnpm --filter @repo/cloud-deploy cn-fast-safe-release validate "$fast_safe_receipt" "$revision" "$baseline_sha" "$manifest" >/dev/null
  record_event prepare_completed
  printf 'CN_PRODUCTION_RELEASE_PREPARED revision=%s\n' "$revision"
  exit 0
fi

[[ "$(git -C "$REPOSITORY_DIR" rev-parse origin/main-cn)" == "$revision" ]] || fail "revision is not origin/main-cn tip"
[[ -d "$release_checkout/.git" && -f "$runtime/prepare-receipt.json" && -f "$fast_safe_receipt" && -f "$baseline_state" ]] || fail "release is not prewarmed; run --prepare before promotion"
[[ "$(git -C "$release_checkout" rev-parse HEAD)" == "$revision" ]] || fail "prepared checkout revision mismatch"
[[ -z "$(git -C "$release_checkout" status --porcelain)" ]] || fail "prepared checkout is dirty"

cd "$release_checkout"

current_baseline_dir=$(mktemp -d "$runtime/.baseline-current.XXXXXX")
current_baseline="$current_baseline_dir/baseline.json"
trap 'rm -rf -- "$current_baseline_dir"' EXIT
capture_baseline "$current_baseline"
baseline_sha=$(baseline_fingerprint "$current_baseline" "$NGINX_CONFIG")
pnpm --filter @repo/cloud-deploy cn-fast-safe-release validate "$fast_safe_receipt" "$revision" "$baseline_sha" "$manifest" >/dev/null || fail "prepared baseline or gates changed"
verify_stable_identity "$current_baseline"

activation_started=1
activation_deadline=$((SECONDS+300))
record_event activation_started
activation_failure() {
  local status=$?
  trap - EXIT
  if [[ "$activation_started" == 1 ]]; then restore_baseline || { echo "CN_DEPLOY_ROLLBACK_UNPROVEN" >&2; exit 1; }; fi
  exit "$status"
}
trap activation_failure EXIT
enable_run_drain
wait_for_run_drain

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
  const [path,config,release,runtime,agent,project,stable]=process.argv.slice(1);
  const value={configFile:config,releaseFile:release,options:{projectName:project,runtimeDirectory:runtime,stableSecretDirectory:stable,agentEnvironmentSecretRef:`file:${agent}`}};
  fs.writeFileSync(path,`${JSON.stringify(value)}\n`,{mode:0o600});
' "$request" "$CONFIG_FILE" "$manifest" "$runtime" "$AGENT_ENV_FILE" "$PROJECT_NAME" "$STABLE_SECRET_DIRECTORY"
chown root:root "$request"
chmod 0600 "$request"

remaining=$((activation_deadline-SECONDS))
(( remaining > 0 )) || fail "activation deadline exceeded before provision"
if ! timeout "${remaining}s" pnpm --filter @repo/cloud-deploy provision "$request"; then
  fail "provision failed"
fi
record_event runtime_ready
remaining=$((activation_deadline-SECONDS))
(( remaining > 0 )) || fail "activation deadline exceeded before browser smoke"
public_url=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.environment.publicUrl)' "$CONFIG_FILE")
record_event browser_acceptance_started
browser_executable=$(resolve_browser_executable) || fail "browser executable missing"
CN_BROWSER_EXECUTABLE_PATH="$browser_executable" timeout "${remaining}s" \
  node .harness/scripts/vm/cn-release-browser-smoke.mjs "$public_url" "$runtime/bootstrap.env" >/dev/null \
  || fail "browser smoke failed"
record_event production_available
activation_started=0
trap - EXIT
rm -rf -- "$current_baseline_dir"
printf 'CN_PRODUCTION_DEPLOYED revision=%s\n' "$revision"
