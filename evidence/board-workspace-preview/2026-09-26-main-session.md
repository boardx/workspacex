# Board workspace preview: primary-session acceptance

Target: issue #4219, localhost:3321/preview/board-workspace.
Baseline inspected: 20112a8dac6d471173ddbe4d29b2c06798189f8e.
Scope: mock UI only; no production persistence, ACL or collaboration claim.

## Additional browser observations

- Error query state: visible “画板暂时无法加载” and retry button. Clicking retry restored all four fixture cards. PASS for mock recovery interaction.
- Forbidden query state: screenshot showed “你没有访问这些画板的权限，请联系管理员。” with no board cards. PASS for mock denied-state presentation, not a server authorization test.
- Empty query state: screenshot showed “第一张画板，从这里开始” with new-board entry and no cards. PASS for mock empty presentation.
- Query-state initialization occurs after hydration; immediate accessibility snapshots can show previous/default content. Screenshots after hydration confirmed the final states above.

## Review findings still awaiting fixes and re-test

Independent review of baseline requested changes:
1. Sticky background/text move and delete separately.
2. Pointer-created sticky does not enter text editing.
3. Returning to library unmounts canvas and loses page-local edits.

Do not treat this evidence as full preview acceptance. Re-test fixes on the submitted exact SHA; production integration and design signoff remain separate gates.

## Fix re-test: c85abfdb8

Primary-session CUA browser acceptance after reload:
- Pointer-selected Sticky, clicked empty canvas, typed 主会话草稿恢复验收 without a separate edit action; Fabric hidden editing textarea had the exact text. PASS.
- Returned to library while editing, reopened 团队创意工作坊; screenshot showed the newly entered text on its yellow paper alongside the two fixtures. PASS for page-local draft restoration.
- Switched Select, dragged the new note from (330,270) to (350,380). Screenshot showed paper and text moving as one selected rectangle. PASS for whole-note movement.
- 375×812 responsive check: core dock and expanded shape/color panel remained fully visible. This is viewport emulation, not real touch hardware evidence.
- Deletion, restored editability, board isolation and final independent re-review are still outstanding.

## Additional fix acceptance

- Opened 新产品体验地图 after editing 团队创意工作坊: only its two fixtures were present; no 主会话草稿恢复验收 note leaked. Returned to original board and its third note remained at the moved location. PASS for observed two-board isolation.
- Double-clicked restored note; editable textarea exposed exact preserved text. PASS for restored editability.
- Independent reviewer approved exact c85abfdb869d1da5713974ed6103921837ca7c5a, P0/P1/P2=0; executed real Fabric serialize/enliven roundtrip preserving PreviewSticky type, text, color,180×160 dimensions and 9/9 tests.
- Full production acceptance, hardware touch/pen, collaboration, storage and human signoff are not claimed.
