# Board Input UX Acceptance

Result: PASS

R1 attached-line fixtures use no arrowhead to avoid entity-sample occlusion; arrowhead styles are NOT accepted by this matrix and require Round02. Free connector overlay fixtures retain arrowheads.

- PASS authorized session and real board creation
- PASS canonical owner seeds navigation fixtures
- PASS wheel, middle/right pan width 1440
- PASS live object/handles/menu/connector width 1440
- PASS held resize controls/menu/edge width 1440
- PASS held rotate controls/menu/edge width 1440
- PASS cancel held object transform Escape width 1440
- PASS cancel held object transform blur width 1440
- PASS middle/right pan begins on connector DOM overlays width 1440
- PASS wheel, middle/right pan width 390
- PASS live object/handles/menu/connector width 390
- PASS held resize controls/menu/edge width 390
- PASS held rotate controls/menu/edge width 390
- PASS cancel held object transform Escape width 390
- PASS cancel held object transform blur width 390
- PASS middle/right pan begins on connector DOM overlays width 390
- PASS multi-selection move resize rotation held follow is one transaction each
- PASS real pen/highlighter gestures preserve centre thickness round caps and single alpha
- PASS real drawing resize rotation undo redo reload preserve ink geometry and opacity
- PASS strong anisotropic drawing multi-eraser is one transaction and one undo
- PASS owned fixture cleanup

Highlighter defaults NOT ACCEPTED pending Round05 #4969. This matrix explicitly configures Pen 100% and Highlighter 25% through real UI; it does not accept the default instrument appearance.

Runner-only v1 pacing: 167 requests, 106077.06433699999 ms wait, minimum 1000 ms dispatch interval. Real API limits remain enabled; 429 is a hard failure without retry.

Browser errors: 0 (browser-errors.json)
