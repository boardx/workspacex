#!/usr/bin/env bash
# Build and publish one immutable China production release before main-cn promotion.
# Registry authentication must already exist in root's Docker credential store.
set -euo pipefail

[[ $# -eq 2 && "$1" =~ ^[a-f0-9]{40}$ && "$2" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$ ]] || {
  echo "usage: publish-cn-release.sh <40-hex-revision> <semantic-release>" >&2; exit 2;
}
[[ ${EUID} -eq 0 ]] || { echo "CN_RELEASE_PUBLISH_REQUIRES_ROOT" >&2; exit 1; }
revision=$1
release=$2

REPOSITORY_DIR=/opt/workspacex-cn/repository
OUTPUT_DIR=/etc/workspacex-cn/releases
RUNNER_ID_FILE=/etc/workspacex-cn/runner-user
platform=${WSX_PLATFORM:-linux/amd64}
prefix=${WSX_REGISTRY_PREFIX:?set WSX_REGISTRY_PREFIX to the new ACR registry/namespace}
node_image=${WSX_NODE_IMAGE:?set WSX_NODE_IMAGE to a reviewed digest}
python_image=${WSX_PYTHON_IMAGE:?set WSX_PYTHON_IMAGE to a reviewed digest}
postgres_image=${WSX_POSTGRES_IMAGE:?set WSX_POSTGRES_IMAGE to a reviewed pgvector digest}
redis_image=${WSX_REDIS_IMAGE:?set WSX_REDIS_IMAGE to a reviewed Redis digest}

fail(){ echo "CN_RELEASE_PUBLISH_REJECTED: $1" >&2; exit 1; }
[[ "$platform" == linux/amd64 || "$platform" == linux/arm64 ]] || fail "unsupported platform"
[[ "$prefix" =~ ^[a-z0-9][a-z0-9.-]*(:[0-9]+)?/[a-z0-9]+([._-][a-z0-9]+)*$ ]] || fail "invalid ACR prefix"
digest_reference='^[a-z0-9][a-z0-9.-]*(:[0-9]+)?/[a-z0-9]+([._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$'
for image in "$node_image" "$python_image" "$postgres_image" "$redis_image"; do
  [[ "$image" =~ $digest_reference ]] || fail "base and data images must use registry digests"
done
[[ -d "$REPOSITORY_DIR/.git" ]] || fail "release repository missing"
[[ "$(git -C "$REPOSITORY_DIR" rev-parse HEAD)" == "$revision" ]] || fail "checkout is not the requested revision"
[[ -z "$(git -C "$REPOSITORY_DIR" status --porcelain)" ]] || fail "release checkout is dirty"
git -C "$REPOSITORY_DIR" merge-base --is-ancestor "$revision" origin/main || fail "release is not contained in origin/main"
[[ -f "$RUNNER_ID_FILE" && ! -L "$RUNNER_ID_FILE" && "$(stat -c '%U:%G:%a' "$RUNNER_ID_FILE")" == root:root:600 ]] || fail "runner identity is not protected"
runner_user=$(cat "$RUNNER_ID_FILE")
[[ "$runner_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "invalid runner identity"
runner_group=$(id -gn "$runner_user")

for command in docker node pnpm git tar cmp; do command -v "$command" >/dev/null 2>&1 || fail "missing build dependency: $command"; done
docker info >/dev/null 2>&1 || fail "Docker daemon unavailable"
if docker buildx version >/dev/null 2>&1; then
  build_engine=buildx
else
  [[ "$platform" == "linux/amd64" ]] || fail "Docker buildx unavailable for non-amd64 platform"
  docker_platform=$(docker info --format '{{.OSType}}/{{.Architecture}}')
  docker_platform=${docker_platform/linux\/x86_64/linux\/amd64}
  [[ "$docker_platform" == "$platform" ]] || fail "Docker buildx unavailable and daemon platform differs"
  build_engine=docker
fi

work=$(mktemp -d /tmp/workspacex-cn-release.XXXXXX)
trap 'rm -rf "$work"' EXIT
mkdir "$work/agent"
git -C "$REPOSITORY_DIR" archive "$revision" apps/deep-agent-service | tar -x -C "$work"
mv "$work/apps/deep-agent-service"/* "$work/agent/"
rmdir "$work/apps/deep-agent-service" "$work/apps"

build_and_push(){
  local service=$1 repository=$2 dockerfile=$3 context=$4; shift 4
  local tag="$prefix/$repository:$revision"
  local existing_revision published_revision
  if docker pull --platform "$platform" "$tag" >/dev/null 2>&1; then
    existing_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$tag")
    [[ "$existing_revision" == "$revision" ]] || fail "existing immutable $service tag has a different revision"
  else
    if [[ "$build_engine" == buildx ]]; then
      docker buildx build --load --platform "$platform" "$@" -f "$dockerfile" -t "$tag" "$context"
    else
      docker build "$@" -f "$dockerfile" -t "$tag" "$context"
    fi
    docker push "$tag" >/dev/null
  fi
  docker pull --platform "$platform" "$tag" >/dev/null
  published_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$tag")
  [[ "$published_revision" == "$revision" ]] || fail "published $service image has a different revision"
}
cd "$REPOSITORY_DIR"
build_and_push api api deploy/aliyun/images/api.Dockerfile . --build-arg "NODE_IMAGE=$node_image" --build-arg "SOURCE_REVISION=$revision"
build_and_push web web deploy/aliyun/images/web.Dockerfile . --build-arg "NODE_IMAGE=$node_image" --build-arg "SOURCE_REVISION=$revision"
build_and_push agent deep-agent "$work/agent/Dockerfile" "$work/agent" --build-arg "PYTHON_IMAGE=$python_image" --build-arg "SOURCE_REVISION=$revision"
build_and_push sandbox skill-sandbox apps/skill-sandbox/Dockerfile apps/skill-sandbox --build-arg "NODE_IMAGE=$node_image" --build-arg "PYTHON_IMAGE=$python_image" --build-arg "SOURCE_REVISION=$revision"

docker pull --platform "$platform" "$postgres_image" >/dev/null
docker pull --platform "$platform" "$redis_image" >/dev/null
node - "$work/build-input.json" "$release" "$revision" "$platform" "$prefix" "$postgres_image" "$redis_image" <<'NODE'
const fs=require("node:fs");
const [path,release,sourceRevision,platform,prefix,postgres,redis]=process.argv.slice(2);
const entry=repository=>({image:`${prefix}/${repository}:${sourceRevision}`});
const value={schemaVersion:1,release,sourceRevision,platform,images:{web:entry("web"),api:entry("api"),agent:entry("deep-agent"),sandbox:entry("skill-sandbox"),postgres:{image:postgres},redis:{image:redis}}};
fs.writeFileSync(path,`${JSON.stringify(value,null,2)}\n`,{mode:0o600,flag:"wx"});
NODE

install -d -o root -g "$runner_group" -m 0750 "$OUTPUT_DIR"
manifest="$OUTPUT_DIR/$revision.json"
generated="$work/release.json"
node --import tsx packages/cloud-deploy/src/release-manifest-cli.ts "$work/build-input.json" "$generated"
if [[ -e "$manifest" ]]; then
  [[ -f "$manifest" && ! -L "$manifest" ]] || fail "existing release manifest is unsafe"
  cmp --silent "$generated" "$manifest" || fail "existing release manifest differs"
else
  install -o root -g "$runner_group" -m 0640 "$generated" "$manifest"
fi
[[ "$(stat -c '%U:%G:%a' "$manifest")" == "root:$runner_group:640" ]] || fail "release manifest permissions differ"
node --import tsx packages/cloud-deploy/src/release-cli.ts validate "$manifest" production >/dev/null
printf 'CN_RELEASE_PUBLISHED revision=%s manifest=%s\n' "$revision" "$manifest"
