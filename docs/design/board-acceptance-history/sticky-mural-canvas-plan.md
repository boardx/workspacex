> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Sticky Mural Canvas Plan

Status: read-only audit and layout/test proposal. Fixed-size font fitting versus automatic height growth is awaiting the user's decision and rule/signoff materials. No sticky rendering policy or schema was changed by this document.

## Official Evidence Versus Product Decisions

[Mural Learning: Add, create and customize sticky notes](https://learning.mural.co/lessons/add-create-and-customize-sticky-notes) documents multiple note shapes/default colours, toolbar drag placement, canvas double-click placement and Tab continuation. Its transcript recommends keeping the standard note size and using board zoom. It does not establish automatic font shrinking, a minimum readable font, circle text layout or clipping rules. Those are WorkspaceX product decisions, not claimed Mural behaviour.

[Mural Learning: Add titles and text boxes](https://learning.mural.co/lessons/add-titles-and-text-boxes) distinguishes brief sticky content from more substantial text-box content. This supports a content-length design discussion, not a licence to silently truncate sticky text.

## Source Map And Existing Behaviour

- `fabric/board-fabric-surface.tsx`: square/rectangle Rect and circle Circle, wrapped Textbox; sticky padding/radius/shadow use `BOARD_FABRIC_VISUAL`, not new constants.
- `fabric/board-fabric-visual.ts`: shared renderer font family, sticky padding/radius and selection controls.
- `whiteboard-fabric-projection.ts`: canonical sticky variant/sizing, typography and colour into render-only appearance.
- `packages/whiteboard-core/src/thinking-input.ts`: sticky/text canonical validation and presets; source of text attributes, not duplicated font tiers.
- `thinking-input-editor.tsx`: transparent textarea overlay, separately estimated line count, hidden overflow; editor ownership is upload worker.
- `fabric/fabric-transform.ts` and core `spatial-geometry.ts`: canonical scene/local transforms. Do not write fitted projection geometry or font size back to canonical text/style.

Square/circle have proportional corner resizing; rectangle has side/corner controls governed by sizing mode. FixedLayout pins the canonical frame after label relayout. Rotation control is cloned before repositioning; world preview drives DOM connector handles/toolbars. Pan/zoom is viewport-only and must not resize glyphs in canonical world units.

## Confirmed Audit Gaps

Current label layout constrains width but not text height. Real `fabric/node` Textbox probe at width132/font20/lineHeight1.3 and canonical frame180x180 returned English height1403.46, CJK1756.02, long unbroken-word874.62 and 16-line463.30; available content height132. FixedLayout retained180x180, so stable controls do not prove visible text containment. These are direct Fabric metric observations, not yet browser product acceptance.

Circle content width is currently diameter minus horizontal padding, independent of measured height. A multi-line rectangular text region can intersect the circular outline even when its width alone fits. Clipping to the circle alone would hide content, not solve readability.

Editor line count uses a fixed glyph-width estimate rather than Fabric measurement. Its rotation origin is centre-centre while canonical scene conversion rotates around unrotated top-left. This is a source discrepancy requiring editor-owner exact-browser verification, not a change authorised in this owner scope.

## Proposed Pure Layout Interface

Owner may add `fabric/sticky-text-layout.ts` and its independent test only after the sizing/readability decision. A pure helper receives canonical frame, variant, existing padding/font attributes, text and an injected metric function. It returns a render-only text frame, measured lines/height, effective font size, fit status and any unavoidable-overflow state. Measurement adapter uses real Fabric Textbox metrics; no character-count estimate, canonical mutation or second font-preset table.

```ts
layoutStickyText({ geometry, variant, text, attributes, padding,
  policy, readableMinimumFontSize }, measure): StickyTextLayout
```

Requested policy alternatives awaiting decision:

1. Preserve chosen note size/shape, wrap graphemes and shrink only as needed down to a user-approved readable lower bound. If content still cannot fit, return explicit overflow state; editing must expose all content through scrolling/expanded editing rather than silent clipping.
2. Preserve requested font size and grow note height through a canonical geometry command. Circle/square aspect-ratio consequences must be signed off; renderer cannot silently become an ellipse/rectangle or change canonical bounds.

The readability minimum is not invented here. Existing schema minimum is validation, not a readability policy. The fit helper must reuse the eventual single authorised token/rule, never introduce another font tier. Font fitting remains renderer-only unless the approved contract explicitly changes that rule.

## Circle Width Depends On Measured Height

For ellipse radii rx/ry after approved padding, centred text with measured height h has available width `2*rx*sqrt(max(0,1-(h/(2*ry))^2))`. For non-middle vertical alignment use the farthest top/bottom text edge from the circle centre instead of h/2. A candidate wrapped text rectangle must satisfy the ellipse equation at every rectangle corner; true circle is rx=ry.

Width and wrapped height are coupled. Evaluate candidate widths with actual metrics and select a feasible rectangle, then search effective font size within approved bounds. Do not use a fixed inscribed square for all content or assume one height measurement is sufficient. Empty text, explicit newlines, mixed CJK/Latin, emoji/graphemes, long words, zero available space and font-loading transitions require deterministic handling. Same world text layout at zoom0.5/1/2; viewport zoom only changes display scale.

## Failure-Test Draft And Integration Gate

Before implementation, add failing cases for English/CJK/longword/multiline overflow, circle-corner containment and frame stability. Measure actual glyphs through Fabric; synthetic metrics may test search edge cases but cannot replace the real renderer proof. Assertions preserve canonical width/height/rotation/style.fontSize and all original text while checking measured content containment or explicit overflow status. No test skips/font-platform catch-and-pass.

Resize/rotation tests verify the same fitted text in each projection rebuild and unchanged shape dimensions under FixedLayout. Input tests cover proportional circle/square controls, rectangle sides, selected/unselected, group transform/cancel and viewport pan/zoom. Browser screenshots/pixel bounds must compare saved render and live editor at multiple zooms, with Chinese IME, long words and explicit newlines. Full editing content must remain accessible at the readable limit.

Surface integration requires advance coordinator notice because it is a shared input/projection entry. Generic shape/text rendering and unrelated drawing cache/connector behaviour stay unchanged. Editor owner adopts the shared layout result rather than copying fitting/measurement logic. Schema/sizing rules belong to files owner. A new Mural-like feature needs signed materials; an explicitly reported existing bug may be repaired only within the agreed minimal policy.
