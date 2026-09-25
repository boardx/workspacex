# Real Board browser acceptance prerequisites

This spec does not mock business APIs/WebSockets or inject principals. The `seeded` project in `playwright.fullstack-smoke.config.ts` runs it against the real isolated stack and maps its existing admin/lead/consultant accounts to Board owner/editor/viewer. A manually prestarted stack can override every `WHITEBOARD_*` value below.

Provide three dedicated, real login accounts in the same organization. Do not use shared dev-mode accounts concurrently with other tests (session kicking). Follow the existing real `/login` + token storage flow; organization membership must already exist. Set:

- `WHITEBOARD_OWNER_EMAIL`, `WHITEBOARD_OWNER_PASSWORD`
- `WHITEBOARD_EDITOR_EMAIL`, `WHITEBOARD_EDITOR_PASSWORD`, `WHITEBOARD_EDITOR_USER_ID`
- `WHITEBOARD_VIEWER_EMAIL`, `WHITEBOARD_VIEWER_PASSWORD`, `WHITEBOARD_VIEWER_USER_ID`
- `WHITEBOARD_API_URL`: reachable API origin, e.g. the isolated stack's loopback API.
- `E2E_BASE_URL`: matching Web origin. Configure Web's HTTP and WebSocket API origins to the same stack.

Run with a main-thread configured Playwright lane against the prepared stack:

```bash
pnpm --filter web exec playwright test e2e/whiteboard-live.spec.ts --workers=1
```

The repository default config may start a Web server on 3197; the main thread should select its full-stack config or reuse the matching prestarted Web. Missing required fixture values fail explicitly. To stage only collaboration/fullscreen first, select `--grep 'independent users'`; that does not prove the Chat case.

The spec creates uniquely named private boards with real HTTP APIs, grants real membership, uses independent browser contexts, asserts Chinese edits both ways and refresh persistence, verifies viewer controls, revokes editor live access, and confirms full-screen geometry. Its meeting-room journey creates a pairing in the presenter UI, joins through the public room page, proves the room is read-only, follows presenter zoom, leaves and resumes follow, then verifies revocation immediately clears Board content. Test boards are archived in cleanup; database/container lifecycle remains the full-stack isolation wrapper's responsibility.

The dedicated resilience soak is opt-in because it runs for 30 minutes by default:

```bash
WHITEBOARD_API_URL=http://127.0.0.1:<api-port> E2E_BASE_URL=http://127.0.0.1:<web-port> \
  pnpm --filter web e2e:whiteboard-room-soak --workers=1
```

`BOARD_ROOM_SOAK_MINUTES` may increase the duration. Values below 30 fail closed and cannot create accepted evidence. The lane attaches `meeting-room-soak-report.json` and fails unless it completes the wall-clock duration, observes monotonically increasing revisions, keeps p95 convergence at or below three seconds, finishes within the x/y and zoom tolerances, and never returns to the pairing screen. It periodically uses real browser offline and Chromium freeze/active transitions; it does not intercept or fulfill application routes.
