# Independent actual base — PR6154 / #6146

Rebuilt on actual develop `97c19b3c423534966114c4ba869abd58efe24748` from only the notification delta. Removed the unmerged activity ancestor entirely. No identity API/contracts/ProfileScreen/live-identity changes, and no activity namespace/negotiation dependency. Three conflicts: two dictionary aggregators and the old activity-bearing test import. Keep actual base plus notification import/spread at the end and the exact notification-only browser assertion block; all existing base profile/password/login checks remain.

TaskNotifications, notifications namespace and dedicated unit file match old head900794cec08093fa3e7952ca7e2faf0fe7d8f4cf byte-for-byte. Original notification API/read/empty/popover/geometry/focus/draft browser assertions are unchanged; activity protocol assertions are not part of this feature and remain in activity PR6147. Existing real browser evidence is historical; final-head CI including self-service journey required. No local heavy browser repeat for unchanged feature logic.

Fresh27cases pass in18.65s; targeted ESLint0. Exact review and normal pre-push next. Lease update must expect old900794cec08093fa3e7952ca7e2faf0fe7d8f4cf; backup refbackup/i18n-notifications-before-independent-20261103 preserves history. Do not force over a changed remote head.

## Actual e473 queue-conflict repair

Nativequeue old41b14efa confirmed UNMERGEABLE/headCommitnull while sourceUNKNOWN; inert actualdevelope4732894d6c478a5d41589ccee21ca3b3d19a917 merge-tree exit1,exactlyen/zh aggregators. Keep actualbase+notification import/spread afterprofile, avoiding account-final and activity-afterprojectList anchors. Four own product/test blobs unchanged41b, including exact browser assertions; no unmerged activity dependency. Fresh27cases pass27.91s; dictESLint0. Originalbrowser remains historical, no rerun. Main has dequeued and both queueEntry null confirmed before upcomingnormalpush; newheadCI and complete newcandidate graph required. No oldattempt artifacts may be reused as newgraph evidence.
