# #5074 Quick conversion workflow recovery

Original browser failure: converting a real-model quick conversation returned HTTP 201 but `/itv/itv-499af8a3-5fd3-4424-8671-1cb7bbc0bbee/setup` returned HTTP 404. Conversion omitted the revision and skill-thread rows required by the workflow reader. The original failure screenshot remains in the total acceptance evidence; it is the dynamic red evidence. No automated red run is claimed.

The fix initializes both records in the conversion transaction. Replay repairs missing initial workflow records without changing the converted ID or copied source materials, and preserves an existing revision/thread.

Browser verification on isolated local ports 15410/15420/15425 with the persisted genuine synthetic quick conversation: click Convert again; the same converted ID opens its Markdown workbench; refresh preserves the screen and the original intake. `conversion-restored.png` shows the actual UI. This verifies recovery, not simulated participant evidence.

API `pnpm --filter api typecheck` exited 0. `pnpm --filter api lint` exited 0 (sandbox attempt failed on tsx IPC EPERM; the permitted rerun passed). Final isolated database regression: 5/5 passed, exit 0, including missing revision/thread fixture recovery, unchanged converted ID/materials, new workflow GET 200, replay workflow GET 200, and tenant denial/nonexistence parity. All owned test stacks/containers/volumes were released. See final log and test summary; earlier attempts are not claimed as replay coverage.
