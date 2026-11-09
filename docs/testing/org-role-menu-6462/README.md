# Organization member role menu — #6462

Root cause: the absolute-positioned PopoverSelect was inside the member table overflow-x-auto container. Its vertical overflow computes to auto and clips the menu. Increasing z-index cannot escape this clipping boundary.

Use the existing shared DropdownMenu portal and collision positioning. No roles, authorization, endpoints or request bodies changed. Preserve aria-disabled on the trigger to retain focus while an update is pending. Existing keyboard navigation, Escape/outside dismissal and radio selection are handled by the shared primitive. Stable test ids remain; accessibility semantics now use menuitemradio/aria-checked.

Evidence: the new regression failed before the fix (4 existing pass/1 fail), then passed: menu is outside the table and Escape restores focus. Organization members/i18n/shared-invite/microinteraction suites: 26 passed. Platform members suites: 9 passed plus 18 localization tests passed after adapting old listbox semantics to the shared radio menu. No failure was hidden or skipped.

IAB local browser, actual MembersTab with synthetic fetch only, no real membership changes: bottom menu fully visible past table border at 1280x720 (bottom.png); 1000x450 viewport menu inside viewport (edge.png); 390x640 menu rect x53..337, y472..542 (mobile.png). Selecting Admin updated the synthetic row and showed old/new role banner; Escape returned focus. Browser console errors: none. Temporary route and owned server removed; viewport reset.

./init.sh quick path passed. harness readiness ran; tick unavailable due to unset COORD_GATEWAY_URL. This is a direct user-assigned ad-hoc issue. No deployment performed.

Independent read-only review found busy key suppression also cancelled Tab; removed the blanket handler and added Tab/ShiftTab/Enter regression (members suite now 6 passed). No remaining review blockers. Total unique affected UI tests: 54 passed across six suites. Initial local TSC encountered stale fabric-markdown dist declarations; rebuilt that dependency before rechecking, with no unrelated source change.

Final local verification: rebuilt dependency and `pnpm --filter web typecheck` exit 0; changed-source ESLint exit 0; git diff --check exit 0.
