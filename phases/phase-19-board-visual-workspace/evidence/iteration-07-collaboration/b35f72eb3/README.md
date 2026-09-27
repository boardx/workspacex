# Comment-directory fixture isolation regression

Main-session verification at b35f72eb3, 2026-09-27:

```sh
pnpm --filter web exec vitest run tests/ui/board-anchored-comments.test.tsx tests/whiteboard/board-content-tools.test.tsx
```

Exit 0: 2 files, 22 tests passed (1.78s). Before the fixture change, CI reported 3 failing tests caused by a missing mention-directory mock and comment-directory reads sharing the image transport spy. The fix isolates only comment read APIs. Image request count remains exactly one; MIME, size, magic bytes, credentials and unmount-abort assertions remain intact, with an additional exact URL assertion on the pending image request. No product code changed. Remote CI and independent review remain separate gates.
