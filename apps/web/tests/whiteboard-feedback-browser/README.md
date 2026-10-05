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
