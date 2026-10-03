#!/usr/bin/env bash
# Stage a root-private, complete Git source cache without changing production checkout.
set -euo pipefail
export_bundle=0
if [[ ${1:-} == --export-bundle ]]; then export_bundle=1; shift; fi
[[ $# -eq 1 || $# -eq 3 ]] || { echo "usage: stage-cn-offline-source-cache.sh <40-hex-sha> [bundle sha256]" >&2; exit 2; }
[[ "$1" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ ${EUID} -eq 0 ]] || exit 1
candidate=$1
bundle=${2:-}
expected=${3:-}
runner_cache=/opt/workspacex-cn/release-origin-cache.git
root_cache=/var/lib/workspacex-cn/source-cache.git
runtime=/var/lib/workspacex-cn/runtime
repository=/opt/workspacex-cn/repository
if [[ "$export_bundle" == 0 ]]; then
  [[ -z "$bundle" || ( "$bundle" == /* && "$expected" =~ ^[a-f0-9]{64}$ ) ]] || exit 2
fi
install -d -o root -g root -m 0700 "$runtime"
exec 9>"$runtime/release.lock"
chmod 0600 "$runtime/release.lock"
flock -n 9 || exit 1

verify_cache(){
  [[ -d "$1" && ! -L "$1" && "$(stat -c '%U:%G:%a' "$1")" == root:root:700 ]] || return 1
  [[ -z "$(find "$1" -type l -print -quit)" ]] || return 1
  [[ ! -e "$1/objects/info/alternates" && ! -e "$1/objects/info/http-alternates" ]] || return 1
  [[ -z "$(find "$1/objects/pack" -maxdepth 1 -name '*.promisor' -print -quit)" ]] || return 1
  GIT_NO_LAZY_FETCH=1 git -C "$1" fsck --full --no-reflogs >/dev/null 2>&1 || return 1
}

if [[ "$export_bundle" == 1 ]]; then
  [[ $# -eq 3 && "$bundle" =~ ^[a-f0-9]{40}$ && "$expected" =~ ^gha-[0-9]+-[0-9]+$ ]] || exit 2
  baseline=$bundle
  # Never inherit caller Git configuration, object stores, executable overrides or prompts.
  for name in $(compgen -v GIT_); do unset "$name"; done
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1
  export GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0
  verify_cache "$root_cache" || exit 3
  [[ "$(git -C "$root_cache" rev-parse refs/heads/main)" == "$candidate" &&
     "$(git -C "$root_cache" rev-parse refs/heads/main-cn)" == "$baseline" ]] || exit 3
  [[ "$(git -C "$repository" remote get-url origin)" == "$runner_cache" &&
     "$(git -C "$repository" rev-parse origin/main-cn)" == "$baseline" &&
     "$(git -c safe.directory="$runner_cache" -C "$runner_cache" rev-parse refs/heads/main-cn)" == "$baseline" ]] || { echo CN_RELEASE_NOT_READY_BASELINE_REPOSITORY >&2; exit 3; }
  GIT_NO_LAZY_FETCH=1 git -C "$root_cache" merge-base --is-ancestor "$baseline" "$candidate" || exit 3
  stage=$(mktemp -d "$runtime/.source-export.XXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  umask 077
  GIT_NO_LAZY_FETCH=1 git -C "$root_cache" bundle create "$stage/source.bundle" refs/heads/main refs/heads/main-cn
  GIT_NO_LAZY_FETCH=1 git -C "$root_cache" bundle verify "$stage/source.bundle" >/dev/null
  cat "$stage/source.bundle"
  exit 0
fi

if [[ ! -e "$root_cache" ]]; then
  [[ -d "$runner_cache" && ! -L "$runner_cache" ]] || exit 1
  stage=$(mktemp -d /var/lib/workspacex-cn/.source-cache.XXXXXX)
  trap 'rm -rf -- "$stage"' EXIT
  umask 077
  git config --file "$stage/gitconfig" --add safe.directory "$runner_cache"
  GIT_CONFIG_GLOBAL="$stage/gitconfig" GIT_NO_LAZY_FETCH=1 git clone --quiet --no-local --single-branch --branch main --bare "$runner_cache" "$stage/cache.git"
  rm -f "$stage/gitconfig"
  chown -R root:root "$stage/cache.git"
  chmod 0700 "$stage/cache.git"
  verify_cache "$stage/cache.git" || exit 1
  [[ "$(git -C "$stage/cache.git" rev-parse refs/heads/main)" == "$candidate" ]] || exit 1
  mv "$stage/cache.git" "$root_cache"
  rmdir "$stage"
  trap - EXIT
else
  verify_cache "$root_cache" || exit 1
  current=$(git -C "$root_cache" rev-parse refs/heads/main)
  if [[ "$current" != "$candidate" ]]; then
    [[ -n "$bundle" && -f "$bundle" && ! -L "$bundle" && "$(sha256sum "$bundle" | awk '{print $1}')" == "$expected" ]] || exit 1
    GIT_NO_LAZY_FETCH=1 git -C "$root_cache" bundle verify "$bundle" >/dev/null
    GIT_NO_LAZY_FETCH=1 git -C "$root_cache" fetch "$bundle" refs/remotes/origin/main >/dev/null
    [[ "$(git -C "$root_cache" rev-parse FETCH_HEAD)" == "$candidate" ]] || exit 1
    git -C "$root_cache" merge-base --is-ancestor "$current" "$candidate"
    git -C "$root_cache" update-ref refs/heads/main "$candidate" "$current"
    verify_cache "$root_cache" || exit 1
  fi
fi
[[ "$(git -C "$root_cache" rev-parse refs/heads/main)" == "$candidate" ]] || exit 1
echo CN_OFFLINE_SOURCE_CACHE=verified
echo CN_PRODUCTION_CHECKOUT=unchanged
