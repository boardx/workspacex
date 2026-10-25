#!/usr/bin/env bash
set -euo pipefail
[[ $# -ge 1 && $# -le 2 ]] || { echo 'Usage: bash manual-release.sh owner/repo [existing-tag]' >&2; exit 2; }
args=(workflow run image-release.yml --repo "$1" --ref main-us -f environment=us -f service=all -f build_only=false)
if [[ $# == 2 ]]; then [[ $2 =~ ^([a-f0-9]{40}-)?[1-9][0-9]*-[1-9][0-9]*$ ]] || exit 2;args+=(-f "tag=$2");fi
gh "${args[@]}"
