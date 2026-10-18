# Strict advanced-base squash evidence reconstruction

Refs #5813. These immutable reconstruction inputs are not new acceptance or a signature.

Original witness: baf90a5fe78284e0324107349f52d062b9488906.
Original log: phases/phase-21-billing-payment/sprints/sprint-06/evidence/F06.verify.log,
blob433d4382e9799ae9f21b1ca80000b1e255ad8988 (unchanged).
Source a290db5da648624829ed359f07c1d2ef52e17d25 tree7c93e37dbe8fe20d918da621a7e1d69777c7e593.
Squash3eb7d004c263e2adb55c46a2553178a1c37de681 treedbf4a292c47c0e87f1f5312619240facd00f22b2,
sole actual parentf11a2c802158641181afcf403a52cf94bffcf5a6.

The config selects immutable candidates only. Each invocation requires witness ancestry to source,
squash ancestry to target, exact sole parent and original path/blob equality at source and squash.
Git merge-tree --write-tree --no-messages actual-parent source must exit0 and return one complete
tree OID exactly equal to the actual squash tree. Missing objects, conflicts, errors, extra output,
wrong source or merely matching paths reject. Git can create unreferenced objects but changes no
refs, index or worktree. No log, test outcome, SQL, production setting or permission changes.

PR CI validates synthetic head's two parents and source identity, then independently checks
event-base to PR source, event-base to actual first parent (advancing main), and actual first parent
to synthetic head. Main's new transitions remain checked. Existing whole-source-tree proofs remain.

Validation is pending: authored through GitHub while this worker's shell recovery is unconfirmed.
The selected real merge-tree must be executed in the existing isolated cloud environment or CI;
source-object reads alone do not prove reconstruction. Added real-Git fixtures cover advanced base,
subsequent target advance, wrong source, altered/missing evidence, missing objects, wrong parent,
foreign witness, conflicts, strict manifest and separate PR/main deltas. No production/30min claim.

Git contract: https://git-scm.com/docs/git-merge-tree
