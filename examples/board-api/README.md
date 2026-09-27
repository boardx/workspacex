# WorkspaceX Board API example

Board objects are changed through the same versioned operation envelope used by the web client,
AI agents and importers. A self-hosted client authenticates as usual and sends a stable UUID
`requestId`; retrying the same body returns the original receipt, while reusing the UUID with a
different body fails closed.

```bash
curl -sS "$WORKSPACEX_URL/api/v1/whiteboards/$BOARD_ID/operations" \
  -H "Authorization: Bearer $WORKSPACEX_TOKEN" \
  -H 'Content-Type: application/json' \
  --data @examples/board-api/create-sticky.json

curl -sS "$WORKSPACEX_URL/api/v1/whiteboards/$BOARD_ID/events?afterSeq=0&limit=100" \
  -H "Authorization: Bearer $WORKSPACEX_TOKEN"
```

Replace the IDs, organization, revision and actor in the example. Service and AI actors must use
their own identity and name the human delegator; the server never trusts a caller-supplied actor
that is unrelated to the authenticated principal.
