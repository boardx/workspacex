# Existing return entry placement (#5262)

Reviewed UI commit 35bb2d2100e5d2fe5cb2fb261ecb936611a0007b, parent caf445c3c65eab8e614ea9ecd60cfaa112879f46. Existing sole worktree reused. No shared cross-module component edits, deployment or merge.

Real independent IAB, own local API/Next/PGlite on 15460/15470/15475, synthetic record itv-594c8506-2d8e-4ea1-a9b1-9682d8413f11. The stack has no configured model and proves no real provider behavior. Concurrent #5118 API/contracts edits were present during local checks; these are not included in this UI commit. Current CI will validate the exact PR tree.

- Desktop intake return visible at top left, before brand/title; clicked and observed /itv?tab=history.
- 390x844 intake same sole return, clicked and observed /itv?tab=history.
- Mobile analysis same sole return at x16,y10, width390, visible.
- Unavailable expert detail return at top left; clicked and observed /itv?tab=experts.
- Existing quick/expert normal/legacy create returns already top left; source reviewed. Canonical six steps share the header; no alternate handler changed.
- Existing 36 header/workflow/expert UI tests passed; web typecheck exit0. No new mirror tests for placement.
- Independent exact-commit review ACCEPT; dirty/revision guards and destinations unchanged, no duplicate return.

Screenshots in this directory are synthetic UI observations. The new-record modal keeps its existing cancel/close behavior; no new return action was added. Missing quick error-state return remains outside this task.
