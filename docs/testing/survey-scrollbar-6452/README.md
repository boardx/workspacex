# Survey scrollbar polish (#6452)

Five native scroll regions in the question editor use a scoped utility: toolbox, settings, canvas, outline dialog and trial-fill panel. Thin themed thumb, transparent track/corner, system colors in forced-colors mode. No global scrollbar override, hidden scrollbar, fixed scroll position or wheel interception.

Validation: survey-outline-popup and survey-responsive-designer: 23 tests PASS; scoped ESLint and diff check PASS. Native IAB local actual editor with 30 synthetic questions at 1440x900: toolbox 671/1034px client/scroll heights, canvas 673/7351px. Wheel scrolling moved canvas to 5394px. Computed scrollbar width thin; dark thumb rgba(184,180,173,.45), light rgba(106,102,98,.45); track rgba(0,0,0,0) in both. Screenshots dark.png/light.png are local synthetic previews, not production acceptance. Forced-colors fallback inspected in CSS, not browser-emulated. Keyboard and outline behavior covered by existing UI regressions; touch hardware not tested.

Initial typecheck found stale fabric-markdown dist missing modelToMarkdown. Rebuilt that package without source changes before repeating typecheck. Temporary route, generated route type, preview server and browser tab removed. No deployment.
