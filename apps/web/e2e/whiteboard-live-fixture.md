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

The spec creates uniquely named private boards with real HTTP APIs, grants real membership, uses three independent browser contexts, asserts Chinese edits both ways and refresh persistence, verifies viewer controls, revokes editor live access, and confirms full-screen geometry. Test boards are archived in cleanup; database/container lifecycle remains the full-stack isolation wrapper's responsibility.
