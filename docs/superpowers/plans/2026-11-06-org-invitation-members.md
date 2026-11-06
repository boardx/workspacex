# Organization invitation and quotas implementation plan

Goal: deliver issue #6316 requirements using existing auth, mail and billing seams.
Spec: docs/superpowers/specs/2026-11-06-org-invitation-members-design.md

Global constraints: default ordinary consultant org role; explicit authenticated acceptance; enterprise default 1000 credit per calendar month, adjustable by administrator; no credit minting or token renaming; no COORD_GATEWAY_URL operations; reuse current worktree and develop integration branch.

- [x] Fetch main/develop, create local feature branch in current worktree; ./init.sh passed.
- [x] Identify invitation root causes and obtain credit unit clarification.
- [x] Backend: ordinary default invitations and no review, mail delivery using canonical transport, accurate failed status/retry.
- [x] Backend: guarded accept APIs for existing accounts; email identity binding, transactional membership and link accounting, standard sessions.
- [x] Frontend: ordinary invitation UI, email delivery status, login return + explicit join, remove overview badges. Owned by invitation_ui.
- [x] Enterprise member credit quota: contracts/migration, admin panel, real monthly usage/holds and admission enforcement. Owned by member_credits.
- [x] Validate relevant API + UI suites/typechecks/lint, independent review, fix findings.
- [ ] Commit/push and create PR to develop with Refs #6316, follow CI to green; report actual deployment boundary.

Review focus: no auto acceptance on GET; no admin grants via legacy review/resend; wrong logged-in account cannot redeem personal invite; duplicate shared link joining never burns capacity twice; failed email does not report delivered; credit reservation races cannot overspend allowance.

Final regression evidence: evidence/org-invitation-6316/. API119, Web115, Python13 passed; API/Web typechecks+lint passed; final independent review found no actionable defect. Affected static checks passed:27/27 tasks; publication/CI pending.

CI correction: kept permission exemption cap128 by moving email projections into existing invitation repository; made quota migration replay-safe; updated retired-review wiring and reviewed migration suffix. New regression evidence in evidence/org-invitation-6316/. PR6325 remains under CI observation; no passing/production claim.
