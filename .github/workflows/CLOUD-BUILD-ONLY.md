# Frozen application build rehearsal

This independent lane is based on public cb3093c62a79bbf3b3dce32eb36fdd3c7c67c977 and reuses the five Dockerfile/context mappings from the reviewed hosted producer. Application source is fixed to fcdd09cdc230b08947f19defb425e86988a3ecc0; control code comes from the exact event commit. It does not import the 27-file production pipeline or an unavailable Mac branch.

One Ubuntu 24.04 plan job resolves three public base images to immutable digests. Five Ubuntu 24.04 jobs build api, web, agent, sandbox and postgres with `--load`, then inspect local image identity. They never call Docker login/push, export registry caches, create release seals, run containers, migrate databases, install privileged tools or dispatch promotion. No GitHub environment, variables, cloud secrets or production host is referenced. An empty temporary Docker credential store and restricted child environment are used. Public dependency downloads remain necessary and can fail due to throttling or availability.

Base tags are resolved at each attempt. The inherited agent Dockerfile also refers to a public uv tag; this rehearsal does not claim a completely frozen dependency closure or authorize promotion. Reports explicitly keep pushed/sealed/prepared/productionActivated/runtimeVerified false. A successful compile is not application runtime or production acceptance.

## First execution after separate publication/run authorization

Publish only this four-file change to `codex/cloud-build-only`. Do not merge main to make a manual button appear. New workflow_dispatch files need default-branch registration under GitHub's documented rules; branch publication alone must not be assumed to enable manual dispatch.

For the first rehearsal, create a draft PR into main for review. This workflow skips draft PRs. After exact HEAD review and execution approval, mark that PR ready for review: its pull_request ready_for_review event starts the workflow without merging. A non-draft PR open/synchronize/reopen event can also start it. Branch updates to a non-draft PR retrigger builds, so each update needs its effects understood. GitHub policy may require approval or impose runner limits.

Creating even a draft PR can run OTHER existing repository PR CI. The draft gate applies only to this workflow. Live main currently retains the legacy prepare-cn-release successful-main workflow_run path, not this PR build's source branch. This draft removes that entry and requires manual dispatch at main with privileged-step rechecks, but that guard is not live until separately merged. Main merges still can start existing Devapp deployment; old CN workflow runs are not retroactively protected. No merge or release is authorized by build-only success. See docs/verification/cloud-release-oidc/manual-prepare-gate.md for the guard-first plan.

Official event rules: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch

## Budget and retention

One plan job has a 10-minute timeout; five builds each have a 60-minute timeout, at most five concurrently: maximum configured sum 310 job-minutes per attempt, excluding GitHub scheduling and other repository CI. This is a ceiling, not an observed duration or monetary estimate. No paid runner, purchase, IAM or resource provisioning is added.

No image tar or BuildKit cache is uploaded. Six JSON artifacts (one plan and five results), each capped at 16 KiB, are kept for 7 days: at most 96 KiB uncompressed payload per attempt, plus service metadata/packaging. Logs follow repository retention. Local images and build caches live only on ephemeral runners and disappear with them. Disk/memory usage has not been measured; large images may exceed standard runner resources and fail. There are no ACR images or production changes from this lane.

## Verification

`python3 -B -m unittest discover -s tests -p test_cloud_build_only.py -v` covers all five command traces, forbidden publishing/privileged commands, identity rejection, missing/wrong public base digests, failure without a success report, and workflow boundaries. Git/archive and Docker calls are mocked in these contract tests; actual Docker images have NOT been built. Actionlint checks syntax with shellcheck and pyflakes disabled. All five Dockerfiles were confirmed present at the frozen source SHA. The 114 tests for the separate full pipeline are not this lane's execution evidence.
