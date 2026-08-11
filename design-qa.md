# Realtime transcription workbench · Design QA

**Final result: passed**

## Comparison target

- Source visual truth: `/Users/shenyangjun/.codex/generated_images/019fefa2-5f13-7a22-8b13-fb94b73ce1f2/exec-86ddbc89-cf37-4b2c-944b-5a98aebf08fd.png`
- Implementation screenshot: `phases/phase-01-run-a-project/ui-preview/realtime-transcription/history-create-dialog.png`
- Workbench screenshot: `phases/phase-01-run-a-project/ui-preview/realtime-transcription/live-workspace.png` (`539 × 930`, responsive completed state).
- Route: `/rec`
- State: history grid with the “新建转录” dialog open, name filled, two tags selected.
- CSS viewport: `1488 × 1058`, `devicePixelRatio = 1`.
- Source pixels: `1487 × 1058`; implementation pixels: `1488 × 1058`.
- Density normalization: none. The source is one physical pixel narrower; comparison uses the common visible content frame and treats the single-pixel edge difference as capture noise.

## Full-view comparison evidence

The source and implementation were opened together at original detail after the browser capture. The major regions align: slim global rail, page title and count, top-right primary action, filter/search row, four-column card grid, dimmed overlay, centered create dialog, name field, tag editor, and right-aligned actions.

Focused-region comparison was required for the dialog because button widths, form density, and the tag focus treatment are too small to judge from page composition alone. The dialog region was inspected at the same viewport and state; its measured implementation box is `448 × 396` at `(520, 331)`.

## Required fidelity surfaces

- Fonts and typography: uses the existing BoardX sans stack with the same Chinese UI hierarchy, semibold headings, compact labels, muted counters, and readable small text. Wrapping and truncation are stable.
- Spacing and layout rhythm: header, controls and card tracks follow the reference. Four equal `321px` tracks render at the comparison viewport. Dialog vertical placement, padding, field gaps and footer alignment match the target rhythm.
- Colors and tokens: all surfaces use the existing semantic BoardX tokens. Primary teal, muted borders, dim overlay, completed badges and focus ring reproduce the target without hard-coded colors.
- Image and asset fidelity: the reference contains no photographic or illustrative raster assets. Standard navigation and control icons use the repository’s existing icon library; no placeholder, CSS art, handmade SVG or emoji asset was introduced.
- Copy and content: title, count, explanation, filters, search, sort, representative history records, modal labels, counters and CTAs follow the selected reference and the confirmed product spec.

## Comparison history

### Iteration 1

- [P1] At the target viewport the first implementation rendered three card columns instead of four, reducing information density and changing the above-the-fold composition.
- [P2] The create dialog was `512px` wide, visibly broader than the source.
- Fixes: moved the desktop grid to four columns at `xl`; changed the dialog to the nearest existing design-system width (`max-w-md`).
- Post-fix evidence: `history-create-dialog.png` shows four equal card columns and a centered `448px` dialog at the target viewport.

### Iteration 2

- [P2] Dialog footer actions were too narrow/wide relative to the source, and the submit button contained an extra plus icon.
- Fixes: removed the extra icon and assigned design-system minimum widths of `96px` and `128px` to the cancel and submit actions.
- Post-fix evidence: the final screenshot shows the two-button group matching the reference proportions and copy.

## Findings

No actionable P0/P1/P2 mismatch remains.

## Primary interactions verified

- Opened the create dialog from the top-right action.
- Filled the transcription name.
- Added two tags with Enter and verified counters.
- Submitted the form; the newly created session immediately replaced the history page with its recording workspace.
- Stopped the new session; the UI moved through “正在收尾” before “已完成”, and analysis actions stayed disabled until completion.
- Returned to history and opened an existing card; the matching completed workspace appeared.
- Filtered by “客户”; six cards remained.
- Searched for a missing item; the guided empty state appeared.
- Checked `375 × 812`, `768 × 900`, and `1280 × 720`; none produced horizontal overflow.
- Browser console: no page errors.

## Follow-up polish

- [P3] The repository-standard global rail is `76px`, while the generated reference is visually closer to `66px`. Changing it would alter every BoardX route, so the confirmed global shell token is preserved.
- [P3] The nearest existing dialog width token is `448px`, roughly `20px` narrower than the source. This does not change hierarchy, wrapping, or task completion.

## Implementation checklist

- [x] Same route, viewport and open-dialog state captured.
- [x] Reference and implementation inspected together.
- [x] P1/P2 findings fixed and re-captured.
- [x] Core interactions exercised in the real browser.
- [x] Responsive overflow and console checked.
