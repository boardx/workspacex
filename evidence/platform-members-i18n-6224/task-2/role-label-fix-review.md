# Scoped selected-role label fix review

BASE `bc266f70bf0ab158de6f68ab61821936548090bf` → HEAD `6eec6508908617d54a168241ada9a35fb6f4bbc5`.

**Spec verdict: PASS for this source increment. Code quality verdict: PASS.** No actionable new P1/P2 findings in the supplied diff.

The supplied second-browser runner records one passing case in 90.317s, runner exit 0 in 590.418s, retry 0. Its image audit records 16 individually root-viewed images: 14 PASS and two operator-roster findings at 375/1280 because selected “Compliance lead” was ellipsized. It explicitly retains WITH_FINDINGS rather than declaring visual acceptance. The same audit documents the earlier identity-width fix as physically good. I reviewed these records, not the private PNGs independently.

The production delta addresses the identified width constraint directly: the page-owned role wrapper grows from `w-32` to `w-40 max-w-full`, preserving its position within the existing wrapping membership row and bounding it by available width. Shared role text, PopoverSelect behavior, canonical roles, IDs, handlers, request/data/state/timer logic are unchanged. This provides extra selected-label space without broad shared-component changes. The appended consolidated audit considers the page's identity, metadata/actions, membership names/dates, shared trigger/options and other text states; its choice to limit edits to the evidenced role wrapper is consistent with this focused patch. Its width estimates remain hypotheses until the actual browser verifies them.

The added browser check is a meaningful strengthening: for each contained role picker in the focused capture region at both existing widths, it checks the direct selected-label span itself is fully in the viewport, then polls for positive `clientWidth` and `clientWidth >= scrollWidth`. Thus an ellipsized label with complete DOM text fails, and a zero-width label cannot satisfy the metric. This is materially stronger than textContent-only or button-bounds checks. Missing label spans fail locator assertions. All previous whole-focus, button, option and global horizontal-overflow checks remain in the supplied hunk; screenshot timing, viewport dimensions, API/persistence assertions, case budgets and retries are not weakened by the delta.

**Final physical acceptance remains pending.** The third native browser run is unrun. Root must execute the original case with the added label-fit checks and individually inspect its final images at 375/1280 before claiming complete selected-label visibility or final visual PASS. This report covers this fix only, not the later whole-branch review.

Covering commands: **not run; root receipts reviewed**. The four supplied receipts bind to exact HEAD `6eec6508908617d54a168241ada9a35fb6f4bbc5`:

- Focused Vitest: exit 0, 32 tests across 3 files, 25.290s.
- Two-file ESLint with zero warnings: exit 0, 7.052s.
- Web typecheck: exit 0, 35.375s.
- `./init.sh`: exit 0, 9.765s.

I read the supplied diff once, the appended Task 1 audit and root evidence/receipts. No Git operations, native gates, services, subagents or other edits were performed; only this requested private review report was written.
