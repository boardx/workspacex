# Survey repair focus regression — #5086

Product source: `73e58b525508b226af30c6c77b264d90aa18409d`, based on main `015f93335f0db3361ee9948d8fcbeacdeb3db2b3`.

The repair target is applied once per request, so editing another question does not repeatedly reselect the original target when questions change. Clearing the request allows the same target to be requested again; a target that has not loaded yet is still applied when it arrives.

Real Codex in-app browser acceptance on a fresh production build:
1. Created disposable local survey `9b32b017-67cf-4aa1-9258-a1325122322b`, with a leading single-choice question and an image multiple-choice question.
2. Publish check returned LEADING_QUESTION. Clicked its repair action and verified question 1 selected.
3. Selected question 2, expanded content, edited both image alternative texts consecutively and both HTTPS image URLs. Question 2 remained selected throughout.
4. Saved, refreshed, reopened question 2. Both alternative texts and URLs persisted.

An initial empty-options fixture failed the design Markdown save validation and was repaired before this acceptance. It is not the successful publish-target fixture.

Validation: meaningful red regression failed before the fix (image_single selected instead of image_multi); after fix 92 UI tests passed across responsive designer and question types, affected ESLint passed, init quick passed, fresh production build passed. Browser evidence is the three adjacent screenshots. Full all-buttons acceptance and PR CI remain separate requirements; this evidence does not certify them complete.

Local logs: `/private/tmp/pr5017-remaining/fix5086-red.log`, `fix5086-green.log`, `fix5086-lint.log`, `fix5086-runtime-status.md`. Database/Minio were preserved during rebuild.
