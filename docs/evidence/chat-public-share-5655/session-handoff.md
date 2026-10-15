# Handoff

Issue: https://github.com/boardx/workspacex/issues/5655
Branch: codex/chat-public-share

Implementation and local acceptance are complete. The feature has not been deployed. PR checks and merge status remain live facts: read them from GitHub rather than inferring them from this document. No feature_list status was modified.

See README.md for API/storage/UI boundaries and reproduction; api-unit.txt, api-http.txt, ui-unit.txt and the phone/desktop PNGs are committed evidence. Original main checkout changes were left untouched.

Next: `gh pr view --json url,headRefOid,mergeStateStatus,statusCheckRollup`, then `pnpm harness pr-queue`. Fix any failing checks/review in the same PR. Only coord-main merges. Run migration 20261013010000_chat_public_shares.sql through the normal deployment lane with the matching API/Web release.

Resources: the owned Web/API test processes are stopped and the dedicated PostgreSQL/Redis compose stack is released after verification. No production environment was changed.
