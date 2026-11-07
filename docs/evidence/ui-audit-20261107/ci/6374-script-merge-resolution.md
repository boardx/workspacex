# PR6374: preserve both reviewed named test lanes

After PR6366 merged at e60cce8866410266f8b096b56cef1dd29cf073b0, GitHub reported PR6374 CONFLICTING/DIRTY. git merge-tree confirmed the sole merge conflict was adjacent script insertions in apps/api/package.json.

Merge resolution retains both unchanged executable commands: test:survey-attachment-metadata-unit and test:report-approval-unit. All other paths follow Git's three-way merge of the already merged develop changes and accepted PR1070f7601228f17ef3a6b0e8a9811d2e3179d1f2. No production/test code is manually changed and no gate/exemption relaxed. The PR was dequeued and temporarily Draft before updating, preventing an old-head merge race.

Verification: JSON parsing and exact config/script existence; full config reachability gate on the merged projection. Existing actual script test results remain in the previous evidence and are not claimed rerun. Final exact-head review, CI and protected merge queue remain mandatory.
