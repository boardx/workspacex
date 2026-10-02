# Survey repair focus regression — #5086

Product source: `73e58b525508b226af30c6c77b264d90aa18409d`, based on main `015f93335f0db3361ee9948d8fcbeacdeb3db2b3`.

The repair target is applied once per request, so editing another question does not repeatedly reselect the original target when questions change. Clearing the request allows the same target to be requested again; a target that has not loaded yet is still applied when it arrives.

Real Codex in-app browser acceptance on a fresh production build:
1. Created disposable local survey `9b32b017-67cf-4aa1-9258-a1325122322b` through the UI. The current design parser blocks invalid logic on save, so the test setup backed up only this zero-response survey and injected a historical backward-jump fixture into its stored questions. This setup is not claimed as successful UI authoring. No other survey was modified.
2. Opened a fresh browser tab and clicked publish check. It returned LOGIC_INVALID for the second question `883abe73-965e-4ea5-b5cc-1d7420688f5f`. Clicked its repair action; verified the non-first single-choice question selected, proving the target request was applied.
3. Selected the first image multiple-choice question, expanded content and edited both alternative texts consecutively (`CURRENT LOGIC 真定位后第一项` / `CURRENT LOGIC 真定位后第二项`). The image question stayed selected and content remained expanded.
4. Selected the logic target, removed its invalid jump through the UI, saved, refreshed and reopened the image question. Both new alternative texts and existing HTTPS URLs persisted.

Independent review rejected an earlier LEADING_QUESTION browser case because that button does not supply a target on this base. Those screenshots were replaced; the earlier case does not count as regression proof. Empty-options and backward-jump authoring attempts were correctly blocked by the save parser.

Validation: meaningful red regression failed before the fix (image_single selected instead of image_multi); after fix 92 UI tests passed across responsive designer and question types, affected ESLint passed, init quick passed, fresh production build passed. Browser evidence is the four adjacent screenshots. Full all-buttons acceptance and PR CI remain separate requirements; this evidence does not certify them complete.

Local logs: `/private/tmp/pr5017-remaining/fix5086-red.log`, `fix5086-green.log`, `fix5086-lint.log`, `fix5086-runtime-status.md`. Database/Minio were preserved during rebuild.

Evidence capture correction: the initial helper retained the old tab binding; the reviewer rejected those mismatched files. All four screenshots and accompanying DOM snapshots were captured directly from the actual regression tab 13 and replaced. Separate image hashes confirm the stages are distinct.
