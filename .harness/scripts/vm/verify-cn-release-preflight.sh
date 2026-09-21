#!/usr/bin/env bash
# Validate and persist one exact, root-protected CN release preflight receipt.
set -euo pipefail

[[ $# -eq 3 && "$1" =~ ^(prebuild|preactivate)$ && "$2" =~ ^[a-f0-9]{40}$ && "$3" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$ ]] || {
  echo "usage: verify-cn-release-preflight <prebuild|preactivate> <40-hex-revision> <semantic-release>" >&2
  exit 2
}
[[ ${EUID} -eq 0 ]] || { echo "CN_RELEASE_PREFLIGHT_REQUIRES_ROOT" >&2; exit 1; }

phase=$1
revision=$2
release=$3
REPOSITORY_DIR=/opt/workspacex-cn/repository
INPUT_ROOT=/etc/workspacex-cn/preflights
RECEIPT_ROOT=/var/lib/workspacex-cn/preflight-receipts
LOCK_FILE=/var/lib/workspacex-cn/runtime/release.lock
input="$INPUT_ROOT/$revision.$phase.json"
receipt_dir="$RECEIPT_ROOT/$revision"
raw_receipt="$receipt_dir/$phase.json"
validated_receipt="$receipt_dir/$phase.validated.json"
stored_prebuild="$receipt_dir/prebuild.json"

fail() { echo "CN_RELEASE_PREFLIGHT_REJECTED: $1" >&2; exit 1; }
private_root_file() {
  local path=$1
  [[ -f "$path" && ! -L "$path" ]] || fail "protected receipt missing: $path"
  [[ "$(stat -c '%U:%G:%a' "$path")" == root:root:600 ]] || fail "protected receipt must be root:root 0600: $path"
}
install_once_or_identical() {
  local source=$1 target=$2
  if [[ -e "$target" ]]; then
    private_root_file "$target"
    cmp --silent "$source" "$target" || fail "immutable receipt differs: $target"
  else
    install -o root -g root -m 0600 "$source" "$target"
  fi
}

[[ -d "$REPOSITORY_DIR/.git" ]] || fail "repository missing"
git -C "$REPOSITORY_DIR" cat-file -e "$revision^{commit}" 2>/dev/null || fail "revision is unavailable"
private_root_file "$input"
install -d -o root -g root -m 0700 "$RECEIPT_ROOT" "$receipt_dir"

# Do not trust a static heldByAttempt claim. Both trusted callers open the
# canonical lock as fd 9 before invoking this verifier. The parent-fd check
# binds the caller to the right file; acquiring a new open description must
# fail while the parent holds flock, otherwise the receipt is rejected.
[[ "$(readlink "/proc/$PPID/fd/9" 2>/dev/null || true)" == "$LOCK_FILE" ]] \
  || fail "caller does not expose the canonical release lock"
exec 8>"$LOCK_FILE"
if flock -n 8; then
  flock -u 8
  fail "canonical release lock is not held by the caller"
fi

work=$(mktemp -d /tmp/workspacex-cn-preflight.XXXXXX)
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
validator="$work/validate_preflight.py"
git -C "$REPOSITORY_DIR" show "$revision:.agents/skills/workspacex-cn-release/scripts/validate_preflight.py" >"$validator" \
  || fail "exact validator is unavailable"
chmod 0500 "$validator"

# The root-protected input is a probe template. Replace the lock assertion with
# evidence produced inside the live critical section; the resulting evidence,
# not the template, becomes the immutable receipt and is embedded by preactivate.
evidence="$work/evidence.json"
node - "$input" "$evidence" "$phase" <<'NODE'
const fs=require("node:fs"),crypto=require("node:crypto");
const [inputPath,outputPath,phase]=process.argv.slice(2);
const value=JSON.parse(fs.readFileSync(inputPath,"utf8"));
const lock=value?.checks?.["runtime.release_lock"];
if(!lock||value.phase!==phase||typeof value.attemptId!=="string"||!value.attemptId)process.exit(1);
const fact=`${value.attemptId}|${phase}|canonical-release-lock-held`;
value.checks["runtime.release_lock"]={status:"passed",evidenceSha256:crypto.createHash("sha256").update(fact).digest("hex"),metadata:{heldByAttempt:true}};
fs.writeFileSync(outputPath,`${JSON.stringify(value)}\n`,{mode:0o600,flag:"wx"});
NODE

output="$work/validated.out"
if ! python3 "$validator" "$evidence" >"$output"; then
  fail "$phase receipt validation failed"
fi
[[ "$(wc -l <"$output" | tr -d ' ')" == 1 ]] || fail "validator stdout must contain exactly one record"
grep -q '^CN_RELEASE_PREFLIGHT_JSON=' "$output" || fail "validator machine record is missing"
sed 's/^CN_RELEASE_PREFLIGHT_JSON=//' "$output" >"$work/result.json"

node - "$evidence" "$work/result.json" "$phase" "$revision" "$release" "$stored_prebuild" <<'NODE' \
  || fail "receipt identity, readiness, or prior evidence differs"
const fs=require("node:fs");
const [inputPath,resultPath,phase,revision,release,storedPrebuild]=process.argv.slice(2);
const input=JSON.parse(fs.readFileSync(inputPath,"utf8"));
const result=JSON.parse(fs.readFileSync(resultPath,"utf8"));
if(result.phase!==phase||result.sourceSha!==revision||result.release!==release||result.ready!==true)process.exit(1);
if(phase==="preactivate"){
  if(!fs.existsSync(storedPrebuild))process.exit(1);
  const prior=JSON.parse(fs.readFileSync(storedPrebuild,"utf8"));
  const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`:JSON.stringify(value);
  // Deep equality is intentionally independent of the validator's receipt hash.
  if(canonical(input.prebuildEvidence)!==canonical(prior))process.exit(1);
}
NODE

install_once_or_identical "$evidence" "$raw_receipt"
install_once_or_identical "$work/result.json" "$validated_receipt"
cat "$output"
