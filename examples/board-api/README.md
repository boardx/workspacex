# Board public API walkthrough

This directory is a runnable client example, not an acceptance result. `workflow.ts` imports the
repository's canonical schemas and route metadata; it does not invent a second API contract.

## Run without a server

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
node --import tsx examples/board-api/workflow.ts --check
```

This checks request shapes for Create, Update, Move, Arrange, Connect, Delete, Read, Events and
Undo. It also rejects an invented `arrange` command and a client-supplied Undo inverse. It makes
**zero HTTP calls**; passing does not prove deployment, authorization or persistence.

## Run against your instance

Use a test organization. The example creates a new board, edits its own objects, deletes one
endpoint (and its connector), restores both through server-authorized Undo, then reads event
pages. It leaves the board visible for inspection; it does not delete pre-existing boards.

Required inputs:

- `WORKSPACEX_API_BASE`: actual API base URL, e.g. `http://127.0.0.1:3200`, or an HTTPS reverse-proxy
  API prefix. No automatic `/api` prefix is assumed. Preserve the deployment's actual routing.
- `WORKSPACEX_TOKEN`: authenticated session bearer token of the delegating user, loaded from
  your secret manager or an owner-readable environment file; never put tokens in committed JSON.
- `BOARD_ACTOR_FILE`: path to JSON with the actor fields shown below.
- `BOARD_EXAMPLE_MUTATE=1`: explicit acknowledgement that the example creates a board.

```json
{
  "kind": "service",
  "actorId": "your-registered-board-service",
  "orgId": "your-organization",
  "role": "owner",
  "scopes": ["board:read", "board:write"],
  "delegatedBy": "authenticated-user-id"
}
```

The actor must already exist, be enabled, and delegate to the authenticated user. This JSON
cannot grant authority. Board role, tenant, delegation and scopes are checked server-side.
The public actor registration/bootstrap endpoint is **not provided by this example**. An
operator must provision it through the deployment's trusted administration process; do not
expose database owner credentials to an API client. Canonical object Read requires this actor
binding even when a human session owns the board.

```sh
# Load credentials using your deployment's secret mechanism before running.
export WORKSPACEX_API_BASE=http://127.0.0.1:3200
export BOARD_ACTOR_FILE=/absolute/private/path/board-actor.json
BOARD_EXAMPLE_MUTATE=1 node --import tsx examples/board-api/workflow.ts --run
```

The script forbids credential-bearing URLs and redirects, requires HTTPS except loopback,
uses bounded timeouts, and never prints tokens or HTTP response bodies. On error it stops;
a timeout may have committed. It deliberately does not retry or clean up uncertain writes.
For a production client, persist the complete operation envelope **before sending** and retry
that identical body/requestId. Reusing an ID with a different body is an idempotency conflict;
creating a new ID on timeout can duplicate writes. The minimal example is not a durable client.

## Contract semantics

| Intent | Actual contract |
| --- | --- |
| Create board | `POST /whiteboards` with `requestId` and `name` |
| Read objects | `GET /v1/whiteboards/:boardId/objects?actorId=...`; canonical objects plus one revision |
| Create / edit / move / connect / delete | `POST /v1/whiteboards/:boardId/operations` |
| Arrange | Compute object geometries, submit all `geometry` commands in one envelope |
| Undo | `POST /v1/whiteboards/:boardId/operations/:operationId/undo` with only `expectedRevision` |
| Events | `GET /v1/whiteboards/:boardId/events?actorId=...&afterEpoch=...&afterSeq=...&limit=...` |

Undo takes the **source operation receipt's revision**, not an arbitrary new head. The current
head must still match that receipt; another edit causes a conflict rather than silently
replacing remote work. The server owns the before-image and checks the authenticated receipt
owner and current actor/board permission. Retrying the same Undo replays its receipt. Undoing
the returned Undo operation is Redo under the same checks. It is separate from AI proposal
confirmation/Undo and from raw Yjs tombstone manipulation.

Events use polling, not a promised SSE subscription endpoint. Persist `nextEpoch` and `nextSeq`
together, deduplicate by `eventId`, poll with backoff, and stop on authorization failure. A full
page can require another request. Do not reset the cursor on every poll or treat an empty page
as a signal to overwrite canonical board state.

The `create-sticky.json` file is a replace-before-use envelope illustration. For executable
code use `workflow.ts`; it obtains a current revision and parses responses against the schema.
The canonical source is [whiteboard-operation.ts](../../packages/contracts/src/whiteboard-operation.ts)
and [whiteboard-document.ts](../../packages/contracts/src/whiteboard-document.ts).

## Verification boundary

This addition passed `node --import tsx examples/board-api/workflow.ts --check`, the
no-argument usage path, and refusal of `--run` without mutation authorization (exit 1).
These were local static/safety checks only; the main session must still run it against a clean
instance. The existing, broader isolated acceptance producer is
[verify-board-agent-api.ts](../../apps/api/scripts/verify-board-agent-api.ts); it includes
negative authorization, idempotency, comment binding and event recovery. It uses trusted test
fixtures and is **not** a production actor bootstrap utility. Its historical evidence does
not establish that this example or a new self-host deployment has run successfully.

Deployment and R8 storage prerequisites: [Board self-host/API guide](../../docs/deployment/BOARD.md).
