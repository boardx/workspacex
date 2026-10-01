# Compact editor chrome candidate

Base `1885ed320`; source observation: the 1024-wide real-model screenshot under `../iteration-09-real-model/c5bfc72df/` had a vertically compressed sync label and anchors on all thirty selected notes.

Changes: identity/sync/collaboration stay in a compact header; edit/view controls move above the bottom creation dock; multi-selection actions occupy a separate row only when selected. Sync text remains one line and keeps its full accessible text/title. Presentation controls no longer overlap header peers. Fit uses measured header/navigation/selection rectangles through ResizeObserver; hiding the selection row releases its reserved space, and responsive header wrapping updates the top inset.

Connector anchors now require hover, one selected object or explicit connector intent. Multi-selection alone shows none. Four anchors remain available through single selection without hover; connector mode exposes targets for touch. Their screen hit area remains 44×44 across zoom, while the visible dot is smaller. Locked/read-only/container exclusions remain.

Worker verification: 59 unit/component tests passed; the browser producer statically collects one test. Web typecheck exited 0 before the final measured-insets addition; final typecheck is queued behind other workers. No browser/Docker/model request was executed by this worker. No visual score is claimed.

Main-session visual acceptance against an existing isolated stack:

```sh
WHITEBOARD_WEB_URL=http://127.0.0.1:<web-port> WHITEBOARD_API_URL=http://127.0.0.1:<api-port> pnpm --filter web exec playwright test --config playwright.board-compact-chrome.config.ts
```

The producer creates a real private Board via official seeded authentication and operation API, loads thirty notes through the production Fabric/Yjs route, checks 1024/1280/1440 layouts, captures screenshots, tests intentional connector-mode exposure and archives its own Board using lifecycle CAS. It checks header/status dimensions, non-overlap, content fit and anchor counts. Human visual review remains required; fixture seeding does not substitute for semantic AI clustering or a touch-hardware test.
