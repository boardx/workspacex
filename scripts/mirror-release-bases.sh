#!/usr/bin/env bash
set -euo pipefail

namespace=${REGISTRY_PREFIX#*/}
[[ $REGISTRY_PREFIX == "$REGISTRY/"* ]]
[[ $REGISTRY =~ ^[a-z0-9-]+-registry\.[a-z0-9-]+\.cr\.aliyuncs\.com$ ]]
[[ $namespace =~ ^[a-z0-9][a-z0-9_-]*$ ]]
if [[ ${MIRROR_BUILDKIT:-false} == true ]]; then
  [[ ${BUILDKIT_REPOSITORY:-} =~ ^[a-z0-9][a-z0-9_-]*$ ]]
fi

if ! command -v skopeo >/dev/null; then
  sudo apt-get update
  sudo apt-get install --yes skopeo
fi
scratch=$(mktemp -d)
trap 'rm -r -- "$scratch"' EXIT
auth="$scratch/auth.json"
printf '%s' "$ACR_PASSWORD" | skopeo login --authfile "$auth" --username "$ACR_USERNAME" --password-stdin "$REGISTRY"
vpc="${REGISTRY%%.*}-vpc.${REGISTRY#*.}"

if [[ ${MIRROR_BUILDKIT:-false} == true ]]; then
  buildkit_source=docker.io/moby/buildkit:buildx-stable-1
  # Release builds target linux/amd64; avoid copying all architectures and
  # attestations from the official index into the application repository.
  buildkit_digest=$(skopeo inspect --raw "docker://$buildkit_source" | python3 -c '
import hashlib,json,re,sys
raw=sys.stdin.buffer.read(2*1024*1024+1)
if len(raw)>2*1024*1024: raise SystemExit("BuildKit index is too large")
index=json.loads(raw)
manifests=index.get("manifests",[]) if isinstance(index,dict) else []
matches=[row for row in manifests if isinstance(row,dict) and
         isinstance(row.get("platform"),dict) and
         row["platform"].get("os")=="linux" and row["platform"].get("architecture")=="amd64"]
if len(matches)!=1 or not re.fullmatch(r"sha256:[a-f0-9]{64}",str(matches[0].get("digest",""))):
    raise SystemExit("Official BuildKit index must identify exactly one linux/amd64 digest")
digest=matches[0]["digest"]
print("Resolved official BuildKit linux/amd64 "+digest+" from index sha256:"+hashlib.sha256(raw).hexdigest(),file=sys.stderr)
print(digest)
')
  BUILDKIT_IMAGE="$buildkit_source@$buildkit_digest"
else
  BUILDKIT_IMAGE=
fi

while read -r key name <&3; do
  source=${!name:-}
  [[ -n $source ]] || continue
  [[ $source =~ ^[a-z0-9][a-zA-Z0-9.:/_-]*@(sha256:[a-f0-9]{64})$ ]]
  digest=${BASH_REMATCH[1]}
  source_repository=${source%@*}
  # Skopeo requires a tag or a digest. Strip a tag only from the last path component.
  if [[ ${source_repository##*/} == *:* ]]; then
    source_repository=${source_repository%:*}
  fi
  repository="$namespace/build-base-${key%_image}"
  target_tag=${digest/:/-}
  if [[ $key == buildkit_image ]]; then
    # Reuse the producer's existing Sandbox/cache repository without creating
    # a repository or overwriting any immutable application release tag.
    repository="$namespace/$BUILDKIT_REPOSITORY"
    target_tag="buildkit-base-$target_tag"
  fi
  target="$REGISTRY/$repository"
  manifest="$scratch/manifest.json"

  if ! skopeo inspect --authfile "$auth" --raw "docker://$target@$digest" > "$manifest"; then
    printf 'Mirroring %s at %s\n' "$key" "$digest"
    skopeo copy --authfile "$auth" --retry-times 2 --all --preserve-digests \
      "docker://$source_repository@$digest" "docker://$target:$target_tag"
    skopeo inspect --authfile "$auth" --raw "docker://$target@$digest" > "$manifest"
  fi
  [[ sha256:$(sha256sum "$manifest" | cut -d' ' -f1) == "$digest" ]]
  printf '%s=%s/%s@%s\n' "$key" "$vpc" "$repository" "$digest" >> "$GITHUB_OUTPUT"
done 3<<'BASE_IMAGES'
node_image NODE_IMAGE
python_image PYTHON_IMAGE
uv_image UV_IMAGE
pgvector_image PGVECTOR_IMAGE
buildkit_image BUILDKIT_IMAGE
BASE_IMAGES
