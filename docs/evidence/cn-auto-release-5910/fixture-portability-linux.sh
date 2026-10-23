#!/usr/bin/env bash
# Run from the repository root. Source mount is read-only; container is disposable.
set -euo pipefail
docker run --rm --user 0:0 --name cn-promotion-fixture-portability -v "$PWD:/source:ro" workspacex-cn-host-tests:node22 sh -c 'set -eu
node -e '\''const {spawnSync}=require("node:child_process");const old=spawnSync("bash",["-c","echo already_active=true >> /dev/stdout"],{encoding:"utf8"});console.log(JSON.stringify({platform:process.platform,node:process.version,oldFixtureStatus:old.status,stderr:old.stderr.trim()}));if(old.status!==1)process.exit(1);'\''
npm install --prefix /tmp/verify --cache /tmp/npm-cache --no-audit --no-fund vitest@2.1.9 yaml
mkdir -p /repo/.harness/scripts/vm /repo/.github/workflows
cp /source/.harness/scripts/vm/cn-promotion-prepared-receipt.test.ts /source/.harness/scripts/vm/deploy-cn-production.sh /source/.harness/scripts/vm/verify-cn-release-promotion.sh /source/.harness/scripts/vm/stage-cn-offline-source-cache.sh /repo/.harness/scripts/vm/
cp /source/.github/workflows/promote-cn-production.yml /source/.github/workflows/prepare-cn-release.yml /repo/.github/workflows/
ln -s /tmp/verify/node_modules /repo/node_modules
cd /repo
/tmp/verify/node_modules/.bin/vitest run --maxWorkers=1 --minWorkers=1 .harness/scripts/vm/cn-promotion-prepared-receipt.test.ts'
printf '\nCleanup check: exact container name must return no IDs\n'
remaining=$(docker ps -aq --filter 'name=^/cn-promotion-fixture-portability$')
if [[ -n "$remaining" ]]; then printf 'FAIL: container remains: %s\n' "$remaining"; exit 1; fi
printf 'PASS: container removed (--rm); no matching running or stopped container\n'
