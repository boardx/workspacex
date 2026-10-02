# Survey autosave undo history — #5109

## Problem and source

Actual UI creation of a short question enabled Undo immediately, but the completed autosave disabled both history buttons. A question created by the existing factory is semantically equal to its SurveyWorkflowQuestionSchema round-trip, while object key order changes (`provenance`/`config`). Raw JSON.stringify therefore treated the server echo as a new external question set and cleared the editor history.

Product commit: `6555ab3a05e23574c76ed792d29deb86cc70d9fc`. Production browser source: `557ac56d36c7c06e32cffa407cd2932600861a6b` (adds the two-populated-stacks counterproof test). This branch does not include the separate, unmerged #5086 / #5098 fixes.

Both compared question signatures now reuse the existing contracts stable JSON serializer. Arrays and actual values remain significant. A genuine remote content change still clears history.

## Real browser evidence

Owned unpublished fixture `fdb761cc-147b-48b9-af0f-203319efd3d5`, CURRENT 标签与新增取消验收, started with one short question and zero responses. No API seeding or patched browser state was used in this chain.

1. Clicked 新增题目: one → two questions. Waited for the header `已保存 · …`, then confirmed Undo enabled (`fix5109-added-after-save`).
2. Clicked Undo: two → one. Waited for the header save completion, then confirmed Redo enabled (`fix5109-undone-after-save`).
3. Clicked Redo: one → two. Waited for the header save completion, then confirmed Undo enabled (`fix5109-redone-after-save`).
4. Reloaded: two questions retained (`fix5109-reloaded.txt`). History intentionally starts empty after page reload; persistence of undo stacks across reload is not claimed.

The pre-fix DOM `current-undo-disabled-after-autosave.txt` records the completed-save failure. Each image and DOM was captured directly from the active browser tab; no reused screenshot closure was used. Three screenshots and four fixed-source DOM captures are paired by filename.

## Validation and limits

- Regression initially failed at the enabled Undo assertion (1 failed / 16 passed).
- Fixed source: 91 UI tests across responsive designer and survey types, plus 10 survey-source contracts tests passed.
- Strengthened test independently rerun: 17 passed. It creates a second history action, undoes it, explicitly verifies both Undo and Redo enabled, then changes question titles externally and asserts both disabled.
- Independent feature reviewer accepted exact `557ac56d36c7c06e32cffa407cd2932600861a6b`, no P0/P1/P2 findings. That review covered source/tests and did not execute the browser.
- `./init.sh --quick` passed dependency/quick-health checks; this is not a full-repository init proof.
- Clean production Web build compiled/typechecked and generated all 124 pages. Web/API health returned 200. Private runtime/backup logs remain outside the repo; no credentials or SQL dumps are committed.
- Before restart, all public survey tables were backed up (SHA256 `880d056692f24cf7cb698a4098db7b397d10a63c7bc861d360e85fb288143991`); pre/post restart counts were identical: 14 workspaces / 8 templates / 3 attachments / 1 upload session.
- Genuine remote-content reset is covered by the regression test, not a two-browser manual conflict run. This evidence certifies the specific autosave undo/redo chain, not all survey buttons, full CI, or permission to merge.

## Evidence hashes

| File | SHA256 |
| --- | --- |
| `fix5109-added-after-save.jpg` | `a6072ff7bac97a975d6f6254eb847ef26fc237241175f2f191857b922cdfc584` |
| `fix5109-added-after-save.txt` | `2888d07257a735a9ae60c02aad48a2c4713e639661e872d0a44060c22fb017c3` |
| `fix5109-undone-after-save.jpg` | `bcc9c9ecf691de69a856a31ae1e4a8c8e39de4f006c371d715cd93fc1f38a3d4` |
| `fix5109-undone-after-save.txt` | `4d7c34f2ee98af7ab054d5948ad4919e7ca21e8dbe9b1e643b8bf84fbdfbed87` |
| `fix5109-redone-after-save.jpg` | `ff4d2f2749a7571728b25a71a80c49dfb4417a05b9367905e21ac01ab5a0c8a5` |
| `fix5109-redone-after-save.txt` | `5b72cfc6dd051c925748d5dba7121aac5ef716020c9a2860579b0f380345d5cd` |
| `fix5109-reloaded.txt` | `3e7f98ad3b5ed630a236faa7506aa88fed329a3117136c080e282b40b0bf9c86` |
| `current-undo-disabled-after-autosave.txt` | `bd6ced1f76dc8c502ac953e917f18447bc190eb816bc06f561fad865484d7d80` |
