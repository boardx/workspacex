#!/usr/bin/env bash
set -euo pipefail
# GitHub expressions compare strings without case sensitivity. This last, non-root
# check binds the specifically authorized branch and checkout before deployment.
[[ "${GITHUB_EVENT_NAME:-}" == 'workflow_dispatch' ]] || { echo 'Skill preview requires workflow_dispatch'; exit 1; }
[[ "${GITHUB_REF:-}" == 'refs/heads/codex/ai-capability-studio-live' ]] || { echo 'Skill preview branch mismatch'; exit 1; }
[[ "${EXPECTED_SKILL_FILES_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Skill preview requires a full lowercase SHA'; exit 1; }
[[ "$EXPECTED_SKILL_FILES_SHA" == "${GITHUB_SHA:-}" ]] || { echo 'Skill preview expected SHA mismatch'; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo 'Skill preview checkout mismatch'; exit 1; }
