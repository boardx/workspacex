# Independent task spec and quality review — #6202

Verdict: clean; no P1/P2 findings in the staged seven-file product change.

Reviewed HEAD f31146d09 and staged product tree 3baecfeb48713f111cc2a8eb5afe64f4ca89d043 against evidence/org-profile-i18n-6202/design.md and task-1-brief.md. Review was static and read-only for product source; no tests, browser, services, checkout or source mutations were run.

Coverage: profile shell title, field labels/help, save/loading/saved, denial/dependency failure/validation, avatar alt/help/upload/busy/success and each rejection branch use current translations. Grants cover empty/denied/dependency failure, approver/missing approver/date, revoke/pending/404/general errors. Extraction covers capability, member read-only, dependency denial, pending, forbidden/general errors. Existing StateShell handles shared states. Chinese copy remains consistent with original wording; existing ui.organization fallback preserves the Chinese initial. English dictionary covers every new Chinese key with typed parity.

Feedback functions passed to React setters are wrapped. Validation closures are stored inside a field object. Errors are translated during rendering through current t, or retained as semantic discriminants; neither load callback nor its effect acquires t/locale dependencies. No locale-driven reset/request or busy-flag change was introduced. Current failure rendering invokes only formatting functions.

Profile empty-patch read, trimmed-name/description save, File upload, artifact ID update, avatar invalidation and updateOrgName calls are unchanged. Tool/user/grant identifiers and tool names remain raw; interpolation is delegated to existing translation machinery. Date conversion retains the original instant and formatting shape and supplies current locale. Grants retain DELETE argument and authoritative reload. Extraction retains checked boolean, capability/admin/busy disabled expression, PUT and error reload. Added pending copy is presentation only. No API/runtime/query/permission changes appear in the staged diff; member/invite code and describeFailureFor implementation remain unchanged.

Exact reviewed staged source blobs:
- apps/web/components/org-admin/knowledge-extraction-toggle.tsx: b77cc48397f84e8b3eab04b0a644f87b636551d1
- apps/web/components/org-admin/org-admin-screen.tsx: 83e742140b327710443314c144c5e64d4a92d260
- apps/web/components/org-admin/standing-tool-grants.tsx: 3c28f7b9a81dd618588617665dc85f3e1a2f1d52
- apps/web/lib/i18n/messages/en.ts: aa6ac7ffc37df65af7ba8161f8b1615a0868e4e3
- apps/web/lib/i18n/messages/zh-CN.ts: bca7e565ef3ef5fa598743dca23b0e055f273878
- apps/web/lib/i18n/namespaces/controls.ts: 22ca1a7a0e66ffcb096619bd798f5df508195381
- apps/web/lib/i18n/namespaces/org-profile.ts: d8cf59813c2741a967fc8392e9386d1161a97fd1

Validation boundary: root reports ten semantic RED-to-GREEN tests and target ESLint exit 0; these were not rerun by this reviewer. Real browser, full type checks and init remain outstanding root work. Seed/browser changes are outside this review. Canonical title relies on Nav PR #6201; do not publish a develop PR containing its unmerged source before actual Nav merge and integration.
