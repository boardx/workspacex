# Organization profile and attached controls — #6202

Actual route /org-admin/profile includes OrgProfileScreen/OrgProfileTab, StandingToolGrantsSection and KnowledgeExtractionToggleSection. Translate their entire UI and states, not only the heading. This feature changes view language only; organization name/description, avatar bytes/artifact IDs, tool names/grant IDs/approver IDs, dates as instants, setting booleans, API shapes and authorization remain unchanged.

Reuse the shared Nav title key adminNavigation.item.org-profile and existing ui.organization/state.saved. Add one typed org-profile namespace for remaining controlled copy. Common save/saving may be added once in controls and reused. Keep existing default Chinese wording and limits (description500, server avatar5MB); do not introduce a second metadata/permission fact table.

Store raw failures or typed/lazy messages, never translated snapshot strings. Locale changes re-render validation/avatar/revoke/save/error feedback without resetting drafts, issuing requests, reconnecting or changing busy flags. Existing Feedback state functions must be wrapped when passed to React state setters. Never add t/locale to load callbacks/effect dependencies. Standing-grant dates use the existing toLocaleString shape with explicit current locale, no instant/timezone/data mutation.

Read-only profile empty-patch load and existing save/avatar/name-refresh paths remain. Revoke stays the same DELETE by grantId and authoritative reload. Extraction keeps deploymentCapable vs orgEnabled distinct, regular-member read/disabled write, admin write/busy/error/reload semantics. Do not change global extraction flags to make a browser branch easy.

Root-owned10 meaningful tests: first8 actualRED7.30s, extra2 actualRED3.12s. Existing declarations/API modules/provider/count queries are preserved. Real browser must prove admin/member boundaries and raw draft/save/reload, including attached controls where the actual isolated capability permits it. A valid seeded standing grant is prerequisite data, not evidence that HITL approval creation was tested. No API/runtime/permission or CI optimization changes.

The source branch initially depended on Nav PR6201 to reuse canonical keys. Do not publish a develop PR containing unmerged Nav source; merge actual develop after its real merge first. That prerequisite was fulfilled by integrating actual merge c49fee15 in 6cd50230, with no inherited Nav delta or web/API source change from the verified tree. Same sole worktree, no worktree creation.
