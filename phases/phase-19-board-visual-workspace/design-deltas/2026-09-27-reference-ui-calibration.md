# Board UI reference calibration — 2026-09-27

User supplied `Codex 图像 2026年9月27日 15_09_54.png` and explicitly requested implementation. This replaces the earlier stacked-bottom-chrome proposal; the supplied image is the visual reference, not a claim about current implementation.

## Layout and interaction

- One quiet top bar: WorkspaceX identity, board title/menu, Undo/Redo, human-readable save state. Real collaborator avatars and working share/presentation actions occupy the right side; no fabricated controls or people.
- Zoom and fit occupy a compact floating control at the upper right of the canvas.
- One centered bottom tool dock: Select, Hand, Sticky, Text, Shape, Connector, Draw, Image and overflow. Primary sticky/draw/shape/connector actions remain first-level and touch accessible.
- Object contextual toolbar appears near and above selection, clamped to viewport. High-frequency color/text/alignment/link/duplicate/delete remain compact; precision and rare operations use overflow/properties.
- Sticky color/shape palette opens above the dock. Opening responds with restrained motion and respects reduced motion. Outside click/Escape closes; keyboard focus is restored.
- Canvas remains the dominant surface: near-white dot grid, soft pastel sticky surfaces, restrained shadow, thin blue selection outline with clear corner handles. Connection handles appear only when useful, never on every item in a large selection.
- Use existing semantic design tokens as the single source. Resolve new Board-specific visual values in a shared token definition, not duplicated component literals. Keep Chinese text legible; the reference hand lettering is not a reason to force unsupported fonts on Chinese content.

## Parallel ownership

A: header, zoom, dock, popovers, contextual-toolbar placement and responsive insets.
C: Fabric sticky appearance, selection controls, grid and shared canvas visual defaults. Coordinate shared adapter files with A before edits.
B: continues Chat diagram semantics/permissions; does not alter visual chrome.
Main session: integrates, runs all real browser acceptance, captures and inspects screenshots, handles PR/CI/review.

## Acceptance

Compare real screenshots against the reference at 1440×900, 1280×720, 1024×768, plus touch/mobile fallback. Capture empty board, three pastel stickies with one selected, open sticky palette, text editing, multi-selection and live collaborators.

Reject overlapping toolbars, vertical sync text, permanently stacked bottom bars, unnecessary technical status, stretched Chinese text, clipped menus, invisible focus or nonfunctional decorative controls. Validate create/type/Tab, color/shape selection, connection handles, Undo/Redo, keyboard/Escape and touch hit areas. Existing Yjs, canonical content, permissions and persisted styles must remain intact.

The Board list retains Studio navigation. The separate create dialog (#4335) retains default title and optional tags; opening a board enters the fullscreen editor.

No screenshot or component test alone establishes a nine-point score. Final integrated functionality, visual review, accessibility, performance and recovery gates remain required.
