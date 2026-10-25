#!/usr/bin/env bash
# Maintainer operation; changes GitHub Environment policy, not runtime services.
set -euo pipefail
[[ $# == 2 && $2 == --apply ]] || { echo 'Usage: bash configure-environment.sh owner/repo --apply';exit 2; }
repo=$1
if gh api "repos/$repo/environments/production-us" >/dev/null 2>&1;then
 echo 'Environment already exists; inspect existing reviewers/policies instead of overwriting';exit 2
fi
printf '%s' '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' | gh api --method PUT "repos/$repo/environments/production-us" --input - >/dev/null
printf '%s' '{"name":"main-us","type":"branch"}' | gh api --method POST "repos/$repo/environments/production-us/deployment-branch-policies" --input - >/dev/null
echo 'production-us created for main-us; no required reviewer configured.'
