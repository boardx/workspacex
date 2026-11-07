# Handoff

Branch worker/develop-only-ci, base origin/develop eeef0cf35925fae24897099dddfcd12f26a1b2af. No new worktree created. Issue #6042.

Run full harness regression, review the workflow routing/production boundaries, create PR targeting develop, and follow CI to green before merge. Do not restore the paused promotion-reuse stash or merge draft #6041. Never report main synchronization as a production deployment.
