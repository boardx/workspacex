#!/usr/bin/env bash
# Root-only aggregate collector. It performs live probes and atomically installs
# one immutable attempt-scoped template for the lock-aware verifier.
set -euo pipefail
operational=0
admission_flag=--operational
source_admission_flag=--operational-source
binding_family=operational-bindings
if [[ ${1:-} == --operational ]]; then operational=1; shift
elif [[ ${1:-} == --maintenance ]]; then
  operational=1; admission_flag=--maintenance; source_admission_flag=--maintenance-source
  binding_family=maintenance-bindings; shift
fi

[[ $# -eq 4 && "$1" =~ ^(prebuild|artifact-build|preactivate)$ && "$2" =~ ^[a-f0-9]{40}$ &&
  "$3" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$ &&
  "$4" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]] || {
  echo "usage: collect-cn-release-preflight <prebuild|preactivate> <40-hex-revision> <semantic-release> <attempt-id>" >&2
  exit 2
}
[[ ${EUID} -eq 0 ]] || { echo "CN_RELEASE_PREFLIGHT_COLLECT_REQUIRES_ROOT" >&2; exit 1; }
phase=$1 revision=$2 release=$3 attempt_id=$4
identity_phase=$phase
if [[ "$phase" == artifact-build ]]; then
  [[ -n ${CN_BUILD_TOOL_BINDING:-} && "$operational" == 0 ]] || { echo "ARTIFACT_BUILD_REQUIRES_BOUND_BUILD_ONLY" >&2; exit 1; }
  identity_phase=prebuild
fi

REPOSITORY_DIR=/opt/workspacex-cn/repository
TOOL_SOURCE_DIR="$REPOSITORY_DIR"
if [[ "$operational" == 1 ]]; then
  [[ "$phase" == preactivate && -z ${CN_BUILD_TOOL_BINDING:-} ]] || exit 1
  operational_binding="/etc/workspacex-cn/$binding_family/$revision/$attempt_id/preactivate.json"
  operational_root=$(python3 /usr/local/lib/workspacex-cn/cn-build-tool-identity.py "$admission_flag" "$operational_binding" "$revision" "$release" "$attempt_id" "$identity_phase") || exit 1
  TOOL_SOURCE_DIR="$operational_root"
elif [[ -n ${CN_BUILD_TOOL_BINDING:-} ]]; then
  TOOL_SOURCE_DIR=$(python3 /usr/local/lib/workspacex-cn/cn-build-tool-identity.py "$CN_BUILD_TOOL_BINDING" "$revision" "$release" "$attempt_id" "$identity_phase") || exit 1
  [[ "$TOOL_SOURCE_DIR" == "${CN_BUILD_TOOL_ROOT:-}" ]] || exit 1
fi
SOURCE_MIRROR=/opt/workspacex-cn/release-origin-cache.git
CONFIG_FILE="/etc/workspacex-cn/candidate-configs/$revision/$attempt_id/deployment.json"
PUBLISH_ENV=/etc/workspacex-cn/publish.env
STABLE_SECRETS=/var/lib/workspacex-cn/stable-secrets
RUNTIME_ROOT=/var/lib/workspacex-cn/runtime
RELEASES_DIR=/etc/workspacex-cn/releases
INPUT_ROOT=/etc/workspacex-cn/preflights
RECEIPT_ROOT=/var/lib/workspacex-cn/preflight-receipts
NGINX_CONFIG=/etc/nginx/conf.d/workspacex-cn.conf
LOCK_FILE=/var/lib/workspacex-cn/runtime/release.lock

fail(){ echo "CN_RELEASE_PREFLIGHT_COLLECT_FAILED: $1" >&2; exit 1; }
private_root_file(){
  [[ -f "$1" && ! -L "$1" && "$(stat -c '%U:%G:%a' "$1")" == root:root:600 ]] ||
    fail "protected input is missing or unsafe"
}

[[ "$(readlink "/proc/$PPID/fd/9" 2>/dev/null || true)" == "$LOCK_FILE" ]] || fail "caller does not expose the canonical release lock"
exec 8>"$LOCK_FILE"
if flock -n 8; then flock -u 8; fail "canonical release lock is not held by this attempt"; fi

[[ -d "$REPOSITORY_DIR/.git" && "$(git -C "$REPOSITORY_DIR" rev-parse HEAD)" == "$revision" ]] ||
  fail "repository is not the exact candidate"
[[ -z "$(git -C "$REPOSITORY_DIR" status --porcelain)" ]] || fail "candidate repository is dirty"
if [[ "$operational" == 1 ]]; then
  SOURCE_MIRROR=$(python3 /usr/local/lib/workspacex-cn/cn-build-tool-identity.py "$source_admission_flag" "$operational_binding" "$revision" "$release" "$attempt_id" "$identity_phase") || exit 1
  source_ref=refs/heads/candidate
elif [[ -n ${CN_BUILD_TOOL_BINDING:-} ]]; then
  SOURCE_MIRROR=$(python3 /usr/local/lib/workspacex-cn/cn-build-tool-identity.py --source "$CN_BUILD_TOOL_BINDING" "$revision" "$release" "$attempt_id" "$identity_phase") || exit 1
  source_ref=refs/heads/candidate
else
  source_ref=refs/heads/main
fi
[[ -d "$SOURCE_MIRROR" && ! -L "$SOURCE_MIRROR" &&
  "$(git -C "$SOURCE_MIRROR" rev-parse --is-bare-repository)" == true ]] || fail "domestic source mirror is unavailable"
[[ "$(git -C "$SOURCE_MIRROR" rev-parse "$source_ref")" == "$revision" ]] || fail "source mirror exact SHA differs"
[[ -z "$(find "$SOURCE_MIRROR/objects/pack" -maxdepth 1 -name '*.promisor' -print -quit)" ]] || fail "source mirror is partial"
GIT_NO_LAZY_FETCH=1 git -C "$SOURCE_MIRROR" fsck --full --no-reflogs >/dev/null ||
  fail "source mirror object closure is incomplete"
(cd "$REPOSITORY_DIR"; node --import tsx packages/cloud-deploy/src/cn-candidate-config-cli.ts verify "$revision" "$release" "$attempt_id") >/dev/null || fail "candidate configuration receipt rejected"
private_root_file "$CONFIG_FILE"
[[ "$(node -e 'process.stdout.write(require(process.argv[1]).provision.release)' "$CONFIG_FILE")" == "$release" ]] || fail "candidate config release differs from requested release"
private_root_file "$PUBLISH_ENV"
[[ -f "$NGINX_CONFIG" && ! -L "$NGINX_CONFIG" ]] || fail "nginx baseline is unavailable"

[[ "$(node -e 'process.stdout.write(require(process.argv[1]).packageManager??"")' "$REPOSITORY_DIR/package.json")" == pnpm@9.15.0 ]] ||
  fail "declared package manager differs"
[[ "$(COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 --version)" == 9.15.0 ]] ||
  fail "offline pnpm toolchain differs"
# Match the candidate lockfile before loading any candidate source probe. No
# dependency download or lifecycle script is allowed at this admission boundary.
COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 --dir "$REPOSITORY_DIR" install --offline --frozen-lockfile --ignore-scripts >/dev/null || fail "exact offline source dependency closure unavailable"

browser_executable=""
for name in chromium-browser chromium google-chrome; do
  candidate=$(command -v "$name" 2>/dev/null || true)
  if [[ "$candidate" == /* && -x "$candidate" ]]; then browser_executable=$candidate; break; fi
done
[[ -n "$browser_executable" ]] || fail "browser executable is unavailable"
CN_BROWSER_EXECUTABLE_PATH="$browser_executable" node "$REPOSITORY_DIR/.harness/scripts/vm/cn-release-browser-smoke.mjs" --preflight >/dev/null ||
  fail "browser runtime preflight failed"

secret_count=$(node - "$CONFIG_FILE" <<'NODE'
const fs=require("node:fs"),value=JSON.parse(fs.readFileSync(process.argv[2],"utf8")),refs=[];
const visit=v=>{if(typeof v==="string"&&v.startsWith("file:"))refs.push(v.slice(5));else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==="object")Object.values(v).forEach(visit);};
visit(value);
if(refs.length<1)process.exit(1);
for(const path of refs){const stat=fs.lstatSync(path),bytes=fs.readFileSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.uid!==0||stat.gid!==0)process.exit(1);}
process.stdout.write(String(refs.length));
NODE
) || fail "secret reference serialization preflight failed"
# Exclude the live caller ancestry; a canonical build/deploy parent is not an orphan.
orphan_count=$(python3 "$TOOL_SOURCE_DIR/.harness/scripts/vm/cn-release-orphans.py") || fail "orphan scan failed"
[[ "$orphan_count" == 0 ]] || fail "orphan release processes are present"
for pair in \
  ".harness/scripts/vm/build-cn-release-candidate.sh:/usr/local/bin/workspacex-cn-build-candidate" \
  ".harness/scripts/vm/deploy-cn-production.sh:/usr/local/bin/workspacex-cn-deploy" \
  ".harness/scripts/vm/publish-cn-release.sh:/usr/local/lib/workspacex-cn/publish-cn-release.sh" \
  ".harness/scripts/vm/verify-cn-release-preflight.sh:/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh" \
  ".harness/scripts/vm/collect-cn-release-preflight.sh:/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh" \
  ".harness/scripts/vm/cn-release-preflight-evidence.mjs:/usr/local/lib/workspacex-cn/cn-release-preflight-evidence.mjs" \
  ".harness/scripts/vm/cn-release-orphans.py:/usr/local/lib/workspacex-cn/cn-release-orphans.py" \
  ".harness/scripts/vm/cn-bootstrap-baseline.cjs:/usr/local/lib/workspacex-cn/cn-bootstrap-baseline.cjs" \
  ".harness/scripts/vm/cn-bootstrap-baseline-source.mjs:/usr/local/lib/workspacex-cn/cn-bootstrap-baseline-source.mjs" \
  ".harness/scripts/vm/cn-baseline-schema-contract.cjs:/usr/local/lib/workspacex-cn/cn-baseline-schema-contract.cjs" \
  ".harness/scripts/vm/cn-bootstrap-source-probe.mjs:/usr/local/lib/workspacex-cn/cn-bootstrap-source-probe.mjs"; do
  source_path="$TOOL_SOURCE_DIR/${pair%%:*}"; installed=${pair#*:}
  [[ -f "$installed" && ! -L "$installed" ]] && cmp --silent "$source_path" "$installed" || fail "trusted entrypoint drift"
done

active_compose=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' workspacex-cn-api-1)
[[ "$active_compose" == "$RUNTIME_ROOT"/*/compose.json ]] || fail "active runtime baseline is untrusted"
baseline_runtime=${active_compose%/compose.json}
baseline_sha=${baseline_runtime#"$RUNTIME_ROOT"/}
[[ "$baseline_sha" =~ ^[a-f0-9]{40}$ ]] || fail "active baseline SHA is invalid"
if [[ "$operational" == 1 ]]; then
  [[ "$(node -e 'process.stdout.write(require(process.argv[1]).baselineRevision)' "$operational_binding")" == "$baseline_sha" ]] || fail "operational active baseline differs"
fi
baseline_secrets="$baseline_runtime/secrets"
legacy_flag=()
if [[ -e "$baseline_runtime/stable-secret-directory.ref" ]]; then
  private_root_file "$baseline_runtime/stable-secret-directory.ref"
  baseline_secrets=$(tr -d '\n' < "$baseline_runtime/stable-secret-directory.ref")
  [[ "$baseline_secrets" == "$STABLE_SECRETS" ]] || fail "baseline stable secret directory drift"
else
  legacy_flag=(--legacy-baseline)
fi
# Compute the exact diff before claiming affected-service evidence. Rebuild all
# services conservatively; this lane does not yet reuse baseline service images.
GIT_NO_LAZY_FETCH=1 git -C "$REPOSITORY_DIR" diff --name-only "$baseline_sha" "$revision" >/dev/null || fail "baseline-to-candidate diff unavailable"

work=$(mktemp -d /tmp/workspacex-cn-preflight-collect.XXXXXX)
DOCKER_CONFIG=$(mktemp -d /tmp/workspacex-cn-preflight-docker.XXXXXX)
export DOCKER_CONFIG
cleanup(){ [[ -z ${bootstrap_container:-} ]] || docker rm -f "$bootstrap_container" >/dev/null 2>&1 || true; docker logout "${registry:-}" >/dev/null 2>&1 || true; rm -rf -- "$work" "$DOCKER_CONFIG"; }
trap cleanup EXIT
# Negative CLI invocation proves the actual pnpm argument forwarding convention.
set +e
COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 --dir "$REPOSITORY_DIR" --silent --filter @repo/cloud-deploy stable-secret-preflight /tmp/wsx-missing-baseline /tmp/wsx-missing-stable >"$work/protocol.out" 2>"$work/protocol.err"
protocol_status=$?
set -e
[[ "$protocol_status" == 1 ]] && grep -q 'STABLE_SECRET_DIRECTORY_DRIFT' "$work/protocol.err" && ! grep -q 'STABLE_SECRET_PREFLIGHT_ARGUMENTS_INVALID' "$work/protocol.err" || fail "pnpm CLI forwarding counterproof failed"

set -a
# shellcheck disable=SC1090
source "$PUBLISH_ENV"
set +a
registry=${WSX_REGISTRY_PREFIX%%/*}
region=${WSX_ACR_REGION:-cn-shanghai}
credentials="$work/acr.json"
aliyun cr GetAuthorizationToken --region "$region" --InstanceId "${WSX_ACR_INSTANCE_ID:?}" --mode EcsRamRole --ram-role-name "${WSX_ECS_RAM_ROLE_NAME:?}" >"$credentials" ||
  fail "temporary ACR authorization failed"
username=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.TempUsername||v.Username||"")' "$credentials")
token=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.AuthorizationToken||"")' "$credentials")
acr_ttl=$(node -e 'const v=require(process.argv[1]),r=v.ExpireTime??v.ExpireDate??v.ExpiresAt,n=typeof r==="number"?(r>1e12?r:r*1000):Date.parse(r??"");process.stdout.write(String(Math.max(0,Math.floor((n-Date.now())/1000))))' "$credentials")
[[ -n "$username" && -n "$token" && "$acr_ttl" =~ ^[0-9]+$ && "$acr_ttl" -ge 1800 ]] ||
  fail "ACR credential is incomplete or too short-lived"
printf '%s' "$token" | docker login --username "$username" --password-stdin "$registry" >/dev/null || fail "ACR login failed"
unset token
rm -f "$credentials"
status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$registry/v2/" || true)
[[ "$status" == 200 || "$status" == 401 ]] || fail "ACR registry probe failed"
baseline_image=$(docker inspect --format '{{.Config.Image}}' workspacex-cn-api-1)
[[ "$baseline_image" == "$registry/"* ]] || fail "baseline image registry differs"
docker manifest inspect "$baseline_image" >/dev/null || fail "authenticated registry manifest request failed"
oss_endpoint=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.environment.ossEndpoint)' "$CONFIG_FILE")
oss_status=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$oss_endpoint") || fail "OSS network probe failed"
[[ "$oss_status" == 200 || "$oss_status" == 403 ]] || fail "OSS endpoint response unrecognized"

managed_out="$work/managed.out"
COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 --dir "$REPOSITORY_DIR" --silent --filter @repo/cloud-deploy managed-data-preflight "$CONFIG_FILE" >"$managed_out" ||
  fail "managed-data live Describe preflight failed"
[[ "$(wc -l <"$managed_out" | tr -d ' ')" == 1 ]] && grep -q '^CN_MANAGED_DATA_PREFLIGHT_JSON=' "$managed_out" ||
  fail "managed-data machine output is invalid"
node - "$managed_out" <<'NODE' || fail "managed-data six live results invalid"
const fs=require("node:fs"),raw=fs.readFileSync(process.argv[2],"utf8"),v=JSON.parse(raw.slice("CN_MANAGED_DATA_PREFLIGHT_JSON=".length));
if(v.passed!==true||v.checks.length!==6||v.checks.some(x=>x.passed!==true))process.exit(1);
NODE
runtime_out="$work/runtime.out"
COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 --dir "$REPOSITORY_DIR" --silent --filter @repo/cloud-deploy runtime-environment-preflight "$CONFIG_FILE" "$STABLE_SECRETS" "$work/bootstrap.env" >"$runtime_out" || fail "runtime serialization/durable profile probe failed"
[[ "$(wc -l <"$runtime_out" | tr -d ' ')" == 1 ]] && grep -q '^CN_RUNTIME_ENVIRONMENT_PREFLIGHT_JSON=' "$runtime_out" || fail "runtime machine output invalid"
node - "$runtime_out" <<'NODE' || fail "runtime env probe output invalid"
const fs=require("node:fs"),raw=fs.readFileSync(process.argv[2],"utf8"),v=JSON.parse(raw.slice("CN_RUNTIME_ENVIRONMENT_PREFLIGHT_JSON=".length));
if(v.ready!==true||v.checkedMaps!==7||!Object.values(v.durableProfiles).every(x=>x===true))process.exit(1);
NODE

timeout 15s docker exec workspacex-cn-api-1 node -e '
const net=require("node:net");
const targets=[[process.env.PGHOST,Number(process.env.PGPORT)],[process.env.REDIS_HOST,Number(process.env.REDIS_PORT)]];
Promise.all(targets.map(([host,port])=>new Promise((resolve,reject)=>{if(!host||!port)return reject();const socket=net.createConnection({host,port});const timer=setTimeout(()=>socket.destroy(new Error()),5000);socket.once("connect",()=>{clearTimeout(timer);socket.destroy();resolve();});socket.once("error",reject);}))).then(()=>process.exit(0),()=>process.exit(1));' || fail "RDS or Redis data-plane network probe failed"

timeout 15s docker exec workspacex-cn-api-1 node -e '
const fs=require("node:fs"),{Client}=require("pg"),ssl=process.env.PGSSLMODE==="disable"?false:{rejectUnauthorized:true,...(process.env.PGSSLROOTCERT?{ca:fs.readFileSync(process.env.PGSSLROOTCERT,"utf8")}: {})};
const client=new Client({connectionTimeoutMillis:5000,statement_timeout:5000,host:process.env.PGHOST,port:Number(process.env.PGPORT),database:process.env.PGDATABASE,user:process.env.DIAG_DB_USER,password:process.env.DIAG_DB_PASSWORD,ssl});
(async()=>{await client.connect();try{await client.query("BEGIN READ ONLY");await client.query("SET LOCAL statement_timeout=5000");const g=await client.query("SHOW transaction_read_only");if(g.rows[0].transaction_read_only!=="on")throw Error();await client.query("SELECT count(*)::int FROM agent_runs WHERE status=ANY($1)",[["queued","running","writeback_pending"]]);}finally{await client.query("ROLLBACK");await client.end();}})().catch(()=>process.exit(1));' || fail "read-only database drain probe failed"

stable_out="$work/stable.out"
COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 --dir "$REPOSITORY_DIR" --silent --filter @repo/cloud-deploy stable-secret-preflight "$baseline_secrets" "$STABLE_SECRETS" "${legacy_flag[@]}" >"$stable_out" || fail "stable secret continuity preflight failed"
[[ "$(wc -l <"$stable_out" | tr -d ' ')" == 1 ]] && grep -q '^CN_STABLE_SECRET_PREFLIGHT ' "$stable_out" || fail "stable secret machine output invalid"
node - "$stable_out" <<'NODE' || fail "stable continuity result invalid"
const fs=require("node:fs"),raw=fs.readFileSync(process.argv[2],"utf8"),v=JSON.parse(raw.slice("CN_STABLE_SECRET_PREFLIGHT ".length));
if(v.ready!==true||v.matchedCount!==12||v.noMutation!==true)process.exit(1);
NODE

# Compare the baseline's actual identity consumers, not just the stable directory
# to itself. Database passwords are supplied by managed-data configuration in
# production; these generated identity secrets must match running consumers.
private_root_file "$baseline_runtime/bootstrap.env"
docker inspect workspacex-cn-api-1 workspacex-cn-agent-1 >"$work/live-consumers.json"
node - "$work/live-consumers.json" "$STABLE_SECRETS" "$baseline_runtime/bootstrap.env" <<'NODE' || fail "stable identity baseline consumer drift"
const fs=require("node:fs"),crypto=require("node:crypto"),values=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const parse=lines=>Object.fromEntries(lines.map(line=>{const i=line.indexOf("=");return [line.slice(0,i),line.slice(i+1)];}));
const api=parse(values[0].Config.Env),agent=parse(values[1].Config.Env),bootstrap=parse(fs.readFileSync(process.argv[4],"utf8").trimEnd().split("\n"));
const compare=(actual,name)=>{const a=Buffer.from(actual??""),b=fs.readFileSync(`${process.argv[3]}/${name}`);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))process.exit(1);};
for(const [key,name] of [["MODEL_CREDENTIAL_KEY","model-cipher"],["EMAIL_VERIFICATION_SECRET","email-verification"],["NATIVE_SESSION_BINDING_KEY","native-binding"],["DEEP_AGENT_SERVICE_INTERNAL_KEY","service-key"]])compare(api[key],name);
compare(agent.DEEP_AGENT_SERVICE_INTERNAL_KEY,"service-key");compare(agent.NATIVE_SESSION_SERVICE_KEY,"service-key");compare(bootstrap.PROVISION_ADMIN_PASSWORD,"admin-password");
NODE

manifest="$RELEASES_DIR/$revision.json"
prior=""
if [[ "$phase" == preactivate ]]; then
  [[ -f "$manifest" && ! -L "$manifest" ]] || fail "sealed manifest is unavailable"
  prior="$RECEIPT_ROOT/$revision/$attempt_id/prebuild.json"
  private_root_file "$prior"
  while IFS=$'\t' read -r service image; do
    [[ "$service" =~ ^(api|web|agent|sandbox)$ ]] || fail "unexpected target service"
    docker pull "$image" >/dev/null || fail "target image cannot be pulled"
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "$revision" ]] || fail "target image revision differs"
    docker image inspect --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}' "$image" | grep -qv '^null null$' || fail "target image entrypoint is empty"
  done < <(node -e 'const v=require(process.argv[1]);for(const s of ["api","web","agent","sandbox"])console.log(`${s}\t${v.images[s].image}`)' "$manifest")
fi

bootstrap_out="$work/bootstrap.out"
if [[ "$phase" != preactivate ]]; then
  timeout 50s node "$TOOL_SOURCE_DIR/.harness/scripts/vm/cn-bootstrap-source-probe.mjs" "$work/bootstrap.env" "$REPOSITORY_DIR" "$identity_phase" "$revision" >"$bootstrap_out" || fail "bootstrap source compatibility failed"
  if [[ "$phase" == prebuild ]]; then
  # The fixed private plan is generated by cn-migration-plan-cli from a complete,
  # independently bound read-only snapshot. Absence/risk/expiry remains a blocker.
  migration_plan="/etc/workspacex-cn/migration-plans/$revision/$attempt_id/plan.json"
  private_root_file "$migration_plan"
  [[ "$baseline_image" == *@sha256:* ]] || fail "baseline image must be immutable"
  [[ "$(docker inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' workspacex-cn-api-1)" == "$baseline_sha" ]] || fail "baseline image source identity differs"
  baseline_schema="/etc/workspacex-cn/baseline-schemas/$baseline_sha.json"
  private_root_file "$baseline_schema"
  timeout 50s docker exec -i workspacex-cn-api-1 node --import tsx --input-type=module -e '
    import fs from "node:fs";import {createRequire} from "node:module";import {Client} from "pg";
    import {appConfig} from "./src/infrastructure/db/pg-config.ts";
    import {migrationFiles,MIGRATIONS_DIR} from "./src/infrastructure/db/migrator.ts";
    let raw="";for await(const chunk of process.stdin)raw+=chunk;
    const input=JSON.parse(raw),Module=createRequire(import.meta.url)("node:module"),m=new Module("/tmp/baseline-probe.cjs");m._compile(input.probe,"/tmp/baseline-probe.cjs");
    const c=new Module("/tmp/schema-contract.cjs");c._compile(input.contract,"/tmp/schema-contract.cjs");
    const client=new Client({...appConfig(),connectionTimeoutMillis:5000,statement_timeout:5000});
    try{await client.connect();const files=Object.fromEntries(migrationFiles().map(name=>[name,fs.readFileSync(MIGRATIONS_DIR+"/"+name)]));
      const result=await m.exports.probe(client,input.plan,input.source,input.baseline,Object.fromEntries(Object.entries(input.files).map(([k,v])=>[k,Buffer.from(v,"base64")])),files,(db,identity)=>c.exports.compareInTransaction(db,input.baselineSchema,identity));
      console.log("CN_BOOTSTRAP_BASELINE_JSON="+JSON.stringify(result));
    }catch{console.error("BOOTSTRAP_BASELINE_UNPROVEN");process.exitCode=1;}finally{await client.end();}
  ' < <(node /usr/local/lib/workspacex-cn/cn-bootstrap-baseline-source.mjs "$REPOSITORY_DIR" "$revision" "$baseline_sha" "$migration_plan" "$baseline_schema" /usr/local/lib/workspacex-cn/cn-bootstrap-baseline.cjs /usr/local/lib/workspacex-cn/cn-baseline-schema-contract.cjs
  ) >"$work/baseline-bootstrap.out" || fail "baseline and migration-plan compatibility failed"
  node - "$bootstrap_out" "$work/baseline-bootstrap.out" <<'NODE'
const fs=require("node:fs"),[target,baseline]=process.argv.slice(2);
const raw=fs.readFileSync(baseline,"utf8");if(!/^CN_BOOTSTRAP_BASELINE_JSON=[^\n]+\n$/.test(raw))process.exit(1);
const original=fs.readFileSync(target,"utf8");if(!/^CN_BOOTSTRAP_COMPAT_JSON=[^\n]+\n$/.test(original))process.exit(1);
const record=JSON.parse(original.slice("CN_BOOTSTRAP_COMPAT_JSON=".length));
record.baselineCompatibility=JSON.parse(raw.slice("CN_BOOTSTRAP_BASELINE_JSON=".length));
fs.writeFileSync(target,"CN_BOOTSTRAP_COMPAT_JSON="+JSON.stringify(record)+"\n");
NODE

  fi

else
  api_image=$(node -e 'process.stdout.write(require(process.argv[1]).images.api.image)' "$manifest")
  api_digest=${api_image##*@}
  migration_plan="/etc/workspacex-cn/migration-plans/$revision/$attempt_id/plan.json"
  private_root_file "$migration_plan"
  # The isolated database must already exist and have completed the approved migrations.
  # This collector creates no databases, runs no migrations, and never redirects to another endpoint.
  node /usr/local/lib/workspacex-cn/cn-bootstrap-baseline-source.mjs --shadow "$REPOSITORY_DIR" "$revision" "$baseline_sha" "$migration_plan" "$work/bootstrap.env" /usr/local/lib/workspacex-cn/cn-bootstrap-baseline.cjs "$manifest" || fail "isolated post-migration target is unproven"
  mv "$work/bootstrap.env.shadow" "$work/bootstrap.env"
  network=$(docker inspect --format '{{range $name,$settings := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' workspacex-cn-api-1 | head -n1)
  [[ -n "$network" ]] || fail "bootstrap network unavailable"
  bootstrap_container="wsx-cn-bootstrap-${attempt_id}"
  ca_mount=()
  ca_path=$(node -e 'const fs=require("fs");const line=fs.readFileSync(process.argv[1],"utf8").split("\n").find(x=>x.startsWith("PGSSLROOTCERT="));if(line)process.stdout.write(line.slice(14))' "$work/bootstrap.env")
  if [[ -n "$ca_path" ]]; then
    [[ -f "$ca_path" && ! -L "$ca_path" && "$ca_path" == /* ]] || fail "bootstrap CA unavailable"
    ca_mount=(--mount "type=bind,src=$ca_path,dst=$ca_path,readonly")
  fi
  # Static import/input smoke has no data-plane connectivity or writable rootfs.
  timeout 30s docker run --rm --pull=never --network=none --read-only --tmpfs /tmp --name "$bootstrap_container" --env-file "$work/bootstrap.env" "${ca_mount[@]}" -e "CN_BOOTSTRAP_PHASE=$phase" -e "CN_BOOTSTRAP_SOURCE_SHA=$revision" -e "CN_BOOTSTRAP_IMAGE_DIGEST=$api_digest" --entrypoint node "$api_image" --import tsx scripts/provision-admin-compatibility.ts --static >"$work/bootstrap-static.out" || fail "bootstrap target static entrypoint failed"
  timeout 50s docker run --rm --pull=never --network "$network" --read-only --tmpfs /tmp --name "$bootstrap_container" --env-file "$work/bootstrap.env" "${ca_mount[@]}" -e "CN_BOOTSTRAP_PHASE=$phase" -e "CN_BOOTSTRAP_SOURCE_SHA=$revision" -e "CN_BOOTSTRAP_IMAGE_DIGEST=$api_digest" --entrypoint node "$api_image" --import tsx scripts/provision-admin-compatibility.ts >"$bootstrap_out" || fail "bootstrap target compatibility failed"
  ! docker inspect "$bootstrap_container" >/dev/null 2>&1 || fail "bootstrap temporary container cleanup unproven"
  bootstrap_container=""
fi
[[ "$(wc -l <"$bootstrap_out" | tr -d ' ')" == 1 ]] && grep -q '^CN_BOOTSTRAP_COMPAT_JSON=' "$bootstrap_out" || fail "bootstrap machine output invalid"
rm -f "$work/bootstrap.env"
[[ ! -e "$work/bootstrap.env" ]] || fail "bootstrap temporary env cleanup unproven"

output_dir="$INPUT_ROOT/$revision/$attempt_id"
install -d -o root -g root -m 0700 "$INPUT_ROOT" "$INPUT_ROOT/$revision" "$output_dir"
candidate="$work/$phase.json"
node "$TOOL_SOURCE_DIR/.harness/scripts/vm/cn-release-preflight-evidence.mjs" "$candidate" "$phase" "$attempt_id" "$revision" "$baseline_sha" "$release" "$secret_count" "$acr_ttl" "$browser_executable" "$manifest" "$prior" "$bootstrap_out" "$runtime_out" "$stable_out" "$managed_out" "$work/protocol.err"

target="$output_dir/$phase.json"
if [[ -e "$target" ]]; then private_root_file "$target"; cmp --silent "$candidate" "$target" || fail "attempt template differs";
else install -o root -g root -m 0600 "$candidate" "$target"; fi
printf 'CN_RELEASE_PREFLIGHT_COLLECTED phase=%s revision=%s attempt=%s\n' "$phase" "$revision" "$attempt_id"
