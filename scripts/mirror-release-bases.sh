#!/usr/bin/env bash
set -euo pipefail

namespace=${REGISTRY_PREFIX#*/}
[[ $REGISTRY_PREFIX == "$REGISTRY/"* ]]
[[ $REGISTRY =~ ^[a-z0-9-]+-registry\.[a-z0-9-]+\.cr\.aliyuncs\.com$ ]]
[[ $namespace =~ ^[a-z0-9][a-z0-9_-]*$ ]]

if ! command -v skopeo >/dev/null; then
  sudo apt-get update
  sudo apt-get install --yes skopeo
fi
scratch=$(mktemp -d)
trap 'rm -r -- "$scratch"' EXIT
auth="$scratch/auth.json"
printf '%s' "$ACR_PASSWORD" | skopeo login --authfile "$auth" --username "$ACR_USERNAME" --password-stdin "$REGISTRY"
vpc="${REGISTRY%%.*}-vpc.${REGISTRY#*.}"

for key in node_image python_image pgvector_image; do
  name=${key^^}
  source=${!name:-}
  [[ -n $source ]] || continue
  [[ $source =~ ^[a-z0-9][a-zA-Z0-9.:/_-]*@(sha256:[a-f0-9]{64})$ ]]
  digest=${BASH_REMATCH[1]}
  repository="$namespace/build-base-${key%_image}"
  target="$REGISTRY/$repository"
  manifest="$scratch/manifest.json"

  if ! skopeo inspect --authfile "$auth" --raw "docker://$target@$digest" > "$manifest"; then
    printf 'Mirroring %s at %s\n' "$key" "$digest"
    skopeo copy --authfile "$auth" --retry-times 2 --all --preserve-digests \
      "docker://$source" "docker://$target:${digest/:/-}"
    skopeo inspect --authfile "$auth" --raw "docker://$target@$digest" > "$manifest"
  fi
  [[ sha256:$(sha256sum "$manifest" | cut -d' ' -f1) == "$digest" ]]
  printf '%s=%s/%s@%s\n' "$key" "$vpc" "$repository" "$digest" >> "$GITHUB_OUTPUT"
done
