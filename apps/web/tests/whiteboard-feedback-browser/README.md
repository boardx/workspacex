# Screenshot feedback browser acceptance (#5355)

This isolated Vite harness imports the production `CollaborativeThinkingEditor`, Fabric surface, theme CSS, canonical Yjs document, command ports and history. It adds no production route and installs no dependencies. The read-only `feedbackSnapshot` function observes canonical state; pointer gestures and writes use product code. The shape comment list has one explicitly mocked response: comment checks prove badge rendering, not API comment creation or persistence.

From repository root, start the owned fixture in one terminal:

```sh
cd apps/web
node tests/whiteboard-feedback-browser/server.mjs
```

Then run from repository root:

```sh
FEEDBACK_OUT=/private/tmp/board-feedback-browser-final node apps/web/tests/whiteboard-feedback-browser/verify.cjs
```

Stop the fixture with Ctrl+C after the run. The fixed port is 33755 and `strictPort` rejects an occupied port. Run Chromium with the same sandbox permissions as other local browser checks. The runner writes a JSON receipt, screenshots and a SHA256 manifest; it fails if whiteboard component/core/contract source changes during the run. Retain failing runs separately.

Covered: icon-only dock and right chevrons; actual native sticky drag creates exactly one object; selected sticky submenu adjacency and viewport boundaries at 1440/390; actual drawing pixels disappear while eraser is held with canonical unchanged, cancellation restores, release commits and undo/redo restore/reapply; ten actual connector handle drags; shape comment badge; shape stroke/radius/dash visual presets update canonical; drawing palette adjacency at 1440/390/1536/1672 with an 8px gap to the outer mother dock; actual held equal-gap drag labels independently centered at gap midpoints. The suite contains fourteen checks including source freeze and zero page errors.

Limits: in-memory component browser proof does not establish API durability, authorization, websocket collaboration, refresh persistence, AI model behavior, OS-native drag image pixels, hardware tablet pressure. Fullstack lanes remain separate. The fixture uses system browser fonts instead of Next font-loader assets. Inspector native range accent is asserted equal to the selected tool neutral primary background; the original blue thumb came from an unsupported foreground design token. Expanded inspector focus checks also prove the fixed header remains inside the panel while the body is scrollable.

## Complete menu audit (#5356)

With the same fixture server running, execute:

```sh
MENU_AUDIT_OUT=/private/tmp/board-all-menu-audit node apps/web/tests/whiteboard-feedback-browser/menu-audit.cjs
MENU_AUDIT_OUT=/private/tmp/board-menu-supplement node apps/web/tests/whiteboard-feedback-browser/menu-supplement.cjs
MENU_AUDIT_OUT=/private/tmp/board-import-audit node apps/web/tests/whiteboard-feedback-browser/import-audit.cjs
```

`audit.html` seeds eight canonical object scenes: sticky, shape, text, connector, drawing, failed image placeholder, frame and multiple stickies. The only exported observer reads canonical state. Menus and mutations are exercised through real pointer, keyboard and accessible product controls. The main runner discovers every visible compact/expanded popover trigger, opens each independently, waits for finite animations, checks viewport boundaries and mother-trigger proximity, exercises an option where available, and verifies Escape focus return. Its six combinations cover 1440×1000 and 390×844 at center, left/top and right/bottom positions. It also opens dock creation pickers, drawing tools, title/help/actions/zoom menus and upload/share dialogs. Desktop and narrow center screenshots are retained; all edge scenarios have JSON geometry receipts.

The supplemental runner checks comments and member suggestions, replacement image dialog, AI unavailable/settings behavior, menu mutual exclusion, live resize, direct grid/tidy canonical changes, sticky sizing and frame layout controls, a frame editor at a nonzero (40,70) origin, and real free-arrow clicks. Free-arrow checks cover canonical unchanged during draft, Enter and double-click completion, Escape cancellation, one-step undo/redo, and waypoint dragging. Its screenshots include open comments/member suggestions, replacement dialog, AI settings and free-arrow preview. Both runners freeze SHA256 component/core/contract source hashes; compare their manifests before accepting a combined run.

Deliberate limits: Frame creation has no reachable product dock entry; it is recorded as unreachable instead of adding one to the fixture. The overview/minimap icon performs fit-board directly and has no submenu. Responsive header entries hidden at narrow width are recorded explicitly. Comments/member lists and AI actor lists use narrowly scoped mock responses; these checks do not establish authenticated API persistence or real model execution. Image replacement proves dialog behavior, not upload/storage success. Native browser select/color surfaces are exercised through their controls rather than claimed as app-rendered popovers. Failed audit receipts remain separate from successful final evidence.

The dedicated `import-shell.html` reproduces the live shell header callback and actual `BoardImportPanel`. It opens the desktop import entry, selects Mural and an actual local JSON file, verifies the enabled submit control, resizes the open panel to390px, and closes it. It never submits a server import. The narrow title/import entry is hidden by product responsive rules. System font tokens are defined at the HTML root so portaled menus inherit them, matching the scope of Next layout font variables. SHA256 manifests include fixtureHTML, runners, server and README as well as production components/core/contracts; do not edit these files during a final run. Run the three Chromium runners sequentially to avoid machine resource contention.
