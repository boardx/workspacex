#!/usr/bin/env bash
# Trusted root entrypoint that turns an exact main commit into one sealed release candidate.
set -euo pipefail

[[ $# -eq 2 && "$1" =~ ^[a-f0-9]{40}$ && "$2" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$ ]] || {
  echo "usage: workspacex-cn-build-candidate <40-hex-revision> <semantic-release>" >&2; exit 2;
}
[[ ${EUID} -eq 0 ]] || { echo "CN_CANDIDATE_REQUIRES_ROOT" >&2; exit 1; }
revision=$1
release=$2
REPOSITORY_DIR=/opt/workspacex-cn/repository
RUNTIME_ROOT=/var/lib/workspacex-cn/runtime
PUBLISH_ENV=/etc/workspacex-cn/publish.env
PUBLISHER=/usr/local/lib/workspacex-cn/publish-cn-release.sh
EVENTS_ROOT=/var/lib/workspacex-cn/release-events

fail(){ echo "CN_CANDIDATE_REJECTED: $1" >&2; exit 1; }
[[ -f "$PUBLISH_ENV" && ! -L "$PUBLISH_ENV" && "$(stat -c '%U:%G:%a' "$PUBLISH_ENV")" == root:root:600 ]] || fail "publish environment is not protected"
[[ -x "$PUBLISHER" && ! -L "$PUBLISHER" ]] || fail "trusted publisher is unavailable"
install -d -o root -g root -m 0700 "$RUNTIME_ROOT" "$EVENTS_ROOT"
exec 9>"$RUNTIME_ROOT/release.lock"
flock -n 9 || fail "another release operation is active"
record_event(){
  node - "$EVENTS_ROOT/$revision.jsonl" "$revision" "$1" <<'NODE'
const fs=require("node:fs"),[path,revision,stage]=process.argv.slice(2);
fs.appendFileSync(path,`${JSON.stringify({schemaVersion:1,revision,stage,at:new Date().toISOString()})}\n`,{mode:0o600});
NODE
  chown root:root "$EVENTS_ROOT/$revision.jsonl"; chmod 0600 "$EVENTS_ROOT/$revision.jsonl"
}
record_event candidate_build_started

for attempt in 1 2 3 4 5; do
  git -C "$REPOSITORY_DIR" fetch --quiet origin main && break
  (( attempt < 5 )) || fail "main fetch failed"
  sleep "$attempt"
done
git -C "$REPOSITORY_DIR" cat-file -e "$revision^{commit}" 2>/dev/null || fail "revision is unavailable"
git -C "$REPOSITORY_DIR" merge-base --is-ancestor "$revision" origin/main || fail "revision is not contained in origin/main"
git -C "$REPOSITORY_DIR" checkout --quiet --detach "$revision"
git -C "$REPOSITORY_DIR" reset --quiet --hard "$revision"
git -C "$REPOSITORY_DIR" clean -ffd
[[ -z "$(git -C "$REPOSITORY_DIR" status --porcelain)" ]] || fail "release checkout is dirty"

# Credentials are obtained from the ECS RAM role for this process only. An isolated
# Docker config prevents the short-lived token from entering root's persistent store.
# The CLI profile name is deliberately explicit: EcsRamRole.
set -a
# shellcheck disable=SC1090
source "$PUBLISH_ENV"
set +a
registry=${WSX_REGISTRY_PREFIX%%/*}
region=${WSX_ACR_REGION:-cn-shanghai}
role_name=${WSX_ECS_RAM_ROLE_NAME:?set WSX_ECS_RAM_ROLE_NAME in publish.env}
DOCKER_CONFIG=$(mktemp -d /tmp/workspacex-cn-docker.XXXXXX)
export DOCKER_CONFIG
cleanup(){ docker logout "$registry" >/dev/null 2>&1 || true; rm -rf "$DOCKER_CONFIG"; }
trap cleanup EXIT
credentials_file="$DOCKER_CONFIG/acr-credentials.json"
cli_config="$DOCKER_CONFIG/aliyun.json"
umask 077
aliyun configure set --profile WSXRelease --mode EcsRamRole --ram-role-name "$role_name" --region "$region" --config-path "$cli_config" >/dev/null || fail "temporary ECS role profile failed"
aliyun cr GetAuthorizationToken --RegionId "$region" --profile WSXRelease --config-path "$cli_config" --output json >"$credentials_file" || fail "temporary ACR authorization failed"
username=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.TempUsername||v.Username||"")' "$credentials_file")
token=$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.AuthorizationToken||"")' "$credentials_file")
[[ -n "$username" && -n "$token" ]] || fail "temporary ACR authorization response is incomplete"
printf '%s' "$token" | docker login --username "$username" --password-stdin "$registry" >/dev/null
rm -f "$credentials_file"
unset token

"$PUBLISHER" "$revision" "$release"
record_event candidate_sealed
printf 'CN_RELEASE_CANDIDATE_READY revision=%s release=%s\n' "$revision" "$release"
