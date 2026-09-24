# Whiteboard SDK (workspace preview)

Small fetch-based client using WorkspaceX's contract source and existing session.
It does not provide anonymous access, API keys or alternate authorization rules.

This directory is the source package used inside the WorkspaceX workspace and is
the intended starting point for a future open-source SDK. It is not currently an
npm package: `private: true` deliberately prevents accidental publication while
the repository has no package publication and licensing contract. Source
availability by itself does not grant a license.

Before publishing it, maintainers must choose and add the applicable open-source
license, establish the public package name and release/versioning policy, publish
built JavaScript and declarations instead of workspace TypeScript paths, replace
the `workspace:*` contract dependency with a publishable dependency or bundled
contract surface, and document supported authentication and security reporting.
Until those prerequisites are complete, consume this package only from this
workspace or from a source checkout under its governing repository terms.

The public Board contract surfaces are discoverable from the contracts root and
remain namespaced to avoid collisions between their `operations` exports:

```ts
import {
  whiteboard,
  whiteboardDocument,
  whiteboardPublic,
  whiteboardSync,
} from '@repo/contracts';

whiteboard.operations.listBoards;
whiteboardPublic.operations.readDocument;
whiteboardSync.WHITEBOARD_SYNC;
```

```ts
import { WhiteboardClient } from '@repo/whiteboard-sdk';
// readCurrentSessionToken is supplied by your existing WorkspaceX session adapter.
// Return the current token each time, so refresh/rotation takes effect immediately.
const boards = new WhiteboardClient(apiBaseUrl, {
  getToken: () => readCurrentSessionToken(),
});
const doc = await boards.document(boardId);
const requestId = crypto.randomUUID();
await boards.commands(boardId, {
  epoch: doc.epoch,
  requestId,
  commands: [{ type: 'text', id: selectedId, index: 0, deleteCount: 0, insert: '协作' }],
});
```

Retain the same requestId and payload for retries. The SDK does not auto-retry or
mint a new ID on a network error. A successful commands response has `durable:true`
and its committed sequence. Epoch checks prevent writes to replaced documents;
they are not object revision checks or a general conflict-resolution mechanism.

WorkspaceX authenticates these requests with `Authorization: Bearer <session>`,
not a cookie-only request. Supply `getToken`, which may be asynchronous and is
called for every request. Missing/invalid tokens fail before fetch. The SDK stores
only the callback, never its returned token, and does not log credentials. It
omits ambient cookies. Alternatively inject an already authenticated fetch via
`{ fetch: authenticatedFetch }` (the legacy second-argument fetch form also works).
If neither a token callback nor an authenticated fetch is supplied, the SDK does
not manufacture credentials; the server rejects protected requests. Never place
credentials in the base URL. Export permissions are not implemented
by this client. Public API methods still require authentication and board ACL.
The package remains private until the publication prerequisites above are met.
