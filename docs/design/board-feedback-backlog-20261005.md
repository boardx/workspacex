# Board screenshot feedback — actionable backlog

Requested 2026-10-05. One user-directed Board UX task, six implementation lanes,
one integrated PR. Base: PR #5245, a848c78ea33f3d2c135d8ef5d716c3a2dfa25893.
This document records delivery scope, not feature passing or human signoff.
The user explicitly authorized bypassing the coordinator identity gate for this
task and delegated implementation decisions to the parent on 2026-10-05.
The six local subagents are implementing under explicit file ownership; this
authorization does not claim a global coordinator lease or merge authority.

| ID | Owner | Action | Acceptance |
|---|---|---|---|
| N1 | navigation | Replace map button's fit action with an expandable minimap | Clicking opens/closes a real board overview; fit remains separately accessible |
| N2 | navigation | Render objects and current viewport; click/drag navigation | Negative coordinates work; navigation preserves zoom and object data; empty and read-only boards work |
| N3 | navigation | Use upward submenu chevrons and rotate on actual open state | Every dock submenu and zoom selector restores direction after Escape/outside dismissal |
| D1 | drawing | Keep four pens and eraser in one row; remove color/width bars below pens | No preview underlines; pen selection retains appearance behavior |
| D2 | drawing | Reduce drawing preset palette to five colors, retain custom color | Width and colors fit one compact row; narrow viewports remain usable |
| D3 | drawing | Verify existing live erasing and repair only reproduced defects | Preview, release, cancellation, undo/redo and save/reopen agree |
| S1 | sticky | Remove editing field's white background, border and shadow | Actual rendered editor is transparent, caret and Chinese input remain usable |
| S2 | sticky | Hide controls according to projected object dimensions | Small objects have no colliding handles/ports; enlarging restores them without changing selection |
| S3 | sticky | Refine sticky inspector spacing, grouping and advanced disclosure | Compact panel stays in viewport; size/style changes persist; read-only remains enforced |
| L1 | layout | Split multi-selection layout into align/arrange/smart-layout categories | Compact tabs replace long two-column matrix |
| L2 | layout | Use icons and miniature layout previews | Existing alignment/distribution/size/template actions remain discoverable with tooltips and accessible labels |
| L3 | layout | Retain spacing, columns, preview and apply/cancel controls | Mixed selections, disabled states, undo and canonical persistence work |
| H1 | shapes | Group common shapes into categorized icon grids | No per-shape visible labels; categories, tooltips, keyboard and drag creation work |
| H2 | shapes | Complete database cylinder geometry | Actual canvas has complete top ellipse and cylinder details at different sizes/zoom, including after reload |
| T1 | format_shortcuts | Replace verbose text submenu with compact formatting controls | Bold/italic, horizontal and vertical alignment, sticky font size work and persist |
| T2 | format_shortcuts | Provide common Chinese/English text font families and add-font workflow | Fonts actually load/render; validated additions persist; no arbitrary script or unverified font behavior |
| T3 | format_shortcuts | Make connector thickness submenu a single icon row without visible title | Thickness previews accurately represent values; selected width persists and undo works |
| K1 | format_shortcuts | Double-click near a sticky to create an aligned style-matching sticky | Nearest valid sticky provides style and alignment; empty/distant areas and read-only behavior are predictable |
| K2 | format_shortcuts | Normalize sticky, connector and drawing keyboard shortcuts | Existing shortcuts retained where possible; text inputs/IME never trigger tools; help reflects actual bindings |

## Ownership and integration

Each lane owns its dedicated components/helpers and relevant tests. Shared
`collaborative-thinking-editor.tsx`, `board-bottom-dock.tsx`, and Fabric surface
edits must be serialized or limited to explicitly assigned sections. Do not alter
the original dirty main checkout or existing Board delivery worktrees.

Each worker reports changed files, commands and exit codes, dynamic evidence,
remaining gaps and integration instructions. The parent reviews the integrated
candidate and verifies real interactions at 1440px and 390px. Unit assertions do
not substitute for rendered appearance or canonical save/reopen evidence.

PR must declare its dependency on #5245; until that parent merges, use its branch
as the PR base so this task does not reintroduce the entire Board delivery diff.
No merge or passing claim before required CI/review gates.
