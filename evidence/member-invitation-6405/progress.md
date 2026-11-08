# #6405 progress

2026-11-08: User confirmed only administrator/member organization roles. Removed member reviewer-function controls and requests, restricted organization/platform selectors to canonical AssignableOrgRole; ordinary member label retains consultant wire compatibility. Added migration for old lead/compliance assignments and role write fences. Project roles remain distinct and untouched. Workshop mail uses existing authorized link issuance; organization/general-project no-review/copy/mail paths were already implemented.

Verified: frontend7 suites47 tests; contracts4; real role management DB16; isolated migration/activation DB8; workshop HTTP/PG2, controller unit4, frontend2. API typecheck/lint passed; integrated Web checks and independent review pending at this checkpoint. See workshop-invitations.md for exact commands and transport limits. No shared DB modifications or deployment.
