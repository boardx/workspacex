# Board service actor API

Status: **contract and application boundary ready; production persistence is not activated**.

Board service actors let a self-hosted integration or AI worker operate one Board with the same object operations as a person. A service actor is always bound to:

- one organization, derived from the authenticated human session;
- one Board, derived from the URL and checked again by persistence;
- one delegating user, fixed at creation;
- explicit scopes (`board:read`, `board:write`, `board:present`, `artifact:read`);
- one expiring, revocable credential.

The caller sends two credentials on service routes:

1. the normal human session in `Authorization: Bearer …`;
2. the Board actor credential in `x-board-actor-credential: wsxb_…`.

The actor credential cannot grant access the human session does not already have. It also cannot be moved to another Board, organization or delegating user. The server derives actor identity, organization, Board and scopes; they are not accepted from the operation body.

## Activation gate

The schemas, application service, controller contract and unit tests are implemented. The controller is deliberately not registered in `KernelModule`, and no executable migration is present. Activation requires a separate, explicit review of the digest-only credential table, tenant RLS policies and `app_rw` privileges described in [the persistence proposal](../../phases/phase-19-board-visual-workspace/design-deltas/2026-09-28-service-actor-persistence-proposal.md).

Do not expose these routes until that gate is complete. This prevents an HTTP surface from being registered against missing or over-privileged storage.

## Lifecycle

Only a current Board owner can create, list or revoke service actors. Creation returns the raw credential exactly once. Store it in a secret manager and never log it. The API stores only its SHA-256 digest and a non-secret prefix for identification.

### Create

```bash
curl --fail-with-body \
  -X POST "$WORKSPACEX_ORIGIN/v1/whiteboards/$BOARD_ID/actors/service" \
  -H "Authorization: Bearer $HUMAN_SESSION" \
  -H 'Content-Type: application/json' \
  --data '{
    "label": "Workshop clustering worker",
    "scopes": ["board:read", "board:write"],
    "expiresInDays": 30
  }'
```

The response contains `actor`, `auditEvent` and `credential`. `Cache-Control: no-store` is set on this response. `credential` is never returned by list calls.

### List

```bash
curl --fail-with-body \
  "$WORKSPACEX_ORIGIN/v1/whiteboards/$BOARD_ID/actors/service" \
  -H "Authorization: Bearer $HUMAN_SESSION"
```

### Revoke

```bash
curl --fail-with-body \
  -X DELETE "$WORKSPACEX_ORIGIN/v1/whiteboards/$BOARD_ID/actors/service/$ACTOR_ID" \
  -H "Authorization: Bearer $HUMAN_SESSION"
```

Rotation is create-new, update the external secret, verify the new credential, then revoke-old. Revocation is immediate for the next request; no raw credential lookup is cached by the application service.

## Board operations

The operation body excludes `boardId` and `actor`. Both are injected server-side after the dual credential check.

```bash
curl --fail-with-body \
  -X POST "$WORKSPACEX_ORIGIN/v1/whiteboards/$BOARD_ID/service/operations" \
  -H "Authorization: Bearer $HUMAN_SESSION" \
  -H "x-board-actor-credential: $BOARD_ACTOR_CREDENTIAL" \
  -H 'Content-Type: application/json' \
  --data "$(cat <<'JSON'
{
  "apiVersion": "2026-09-01",
  "requestId": "00000000-0000-4000-8000-000000000101",
  "expectedRevision": { "epoch": 1, "seq": 0 },
  "commands": [{
    "type": "create",
    "object": {
      "id": "idea-1",
      "schemaVersion": 1,
      "kind": "sticky",
      "geometry": { "x": 0, "y": 0, "width": 200, "height": 200, "rotation": 0 },
      "text": "First idea",
      "style": {},
      "parentId": null,
      "orderKey": ""
    }
  }],
  "provenance": {
    "source": "public-api",
    "model": null,
    "skill": null,
    "sourceArtifactId": null,
    "sourceRevision": null,
    "layoutHash": null,
    "inputObjectIds": []
  }
}
JSON
)"
```

Read objects and events use the same headers:

```bash
curl --fail-with-body \
  "$WORKSPACEX_ORIGIN/v1/whiteboards/$BOARD_ID/service/objects" \
  -H "Authorization: Bearer $HUMAN_SESSION" \
  -H "x-board-actor-credential: $BOARD_ACTOR_CREDENTIAL"

curl --fail-with-body \
  "$WORKSPACEX_ORIGIN/v1/whiteboards/$BOARD_ID/service/events?afterEpoch=1&afterSeq=0&limit=100" \
  -H "Authorization: Bearer $HUMAN_SESSION" \
  -H "x-board-actor-credential: $BOARD_ACTOR_CREDENTIAL"
```

## TypeScript fetch example

```ts
type BoardActorClientOptions = {
  origin: string;
  boardId: string;
  humanSession: string;
  actorCredential: string;
};

export async function executeBoardOperation(
  options: BoardActorClientOptions,
  input: unknown,
) {
  const response = await fetch(
    `${options.origin}/v1/whiteboards/${options.boardId}/service/operations`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.humanSession}`,
        'x-board-actor-credential': options.actorCredential,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(`Board operation failed: ${response.status}`);
  return response.json();
}
```

Never place either credential in a URL. Redact `Authorization` and `x-board-actor-credential` in proxies, traces and error reports.

## Errors

| HTTP | Meaning |
| --- | --- |
| `400` | Invalid schema, client-supplied actor/Board envelope, or invalid cursor |
| `401` | Missing, malformed, expired, revoked or incorrectly bound actor credential |
| `403` | Human lacks Board access, owner-only lifecycle action, or missing scope |
| `404` | Board or actor does not exist within the current tenant |
| `409` | Board archived, stale revision, or idempotency conflict |
| `503` | Required persistence/operation dependency unavailable |

Lifecycle events are append-only `ServiceActorCreated` and `ServiceActorRevoked` records. They include actor, Board, delegator, scopes and timestamp, and never include the raw credential or digest.
