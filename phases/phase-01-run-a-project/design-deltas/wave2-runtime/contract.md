# Wave 2 runtime contract delta

Status: proposed; human signoff required.

This document is the normative single source of truth for the Wave 2 delta in
issue #409. Existing signed auth, chat, skills, and agent-runtime bundles remain
historical inputs and are not silently amended. If this packet conflicts with
an existing bundle, implementation stops until a human signs the delta.

## Context, decision, consequences, and alternatives

Wave 1 exposes partial contracts and prototype UI but cannot prove a real
registration-to-agent-reply journey. Wave 2 therefore adds the smallest durable
vertical slice: confirm an email, persist a human Chat message, resolve immutable
Agent/Skill/model inputs, execute one model call without tools, and persist the
reply back to Chat.

The decision is to use durable database state, transactional outboxes where an
external side effect is involved, separate explicit administrator imports for
starter Skills and Agents, one model provider with no fallback, and polling for
run progress.
SSE, MCP/tools, approvals, recovery orchestration, multi-provider fallback, and
automatic starter content are out of scope.

This choice gives a small, observable path with stable retry semantics. Its cost
is extra persisted state and temporary polling load. We reject inline email
delivery, synchronous inline Agent replies, mutable Skill snapshots, hidden
built-ins, and SSE-first delivery because each makes failure or replay ambiguous.

## 1. Registration email confirmation

### Use case and lifecycle

1. Registration commits the new user, a random verification challenge, and a
   mail-outbox record in one transaction. The response says `queued`, not `sent`.
2. Only a digest of the 256-bit random token is stored. The raw token appears
   once in the mail URL and expires 24 hours after issue.
3. The public URL is `/auth/verify-email?token=<raw-token>`. The page removes the
   token from browser history immediately, then calls the API using the body.
4. `POST /auth/email-verifications/confirm` accepts `{ token }`. First valid use
   verifies the user and consumes the challenge atomically. Replays are safe but
   return the same generic completed response; invalid and expired tokens share
   a generic `VERIFICATION_LINK_INVALID` response to avoid account enumeration.
5. Confirmation does not create a login session. The user signs in normally.

### Mail transport

The outbox worker is the only mail transport caller. It records attempt count,
provider message ID, delivered/failed status, and a redacted failure category.
Retries reuse the same outbox identity. Registration remains committed if a mail
provider is unavailable; UI shows queued delivery and supports an independently
rate-limited resend. Development tests use a captured-mail transport, while the
full journey must use the configured real transport or its staging sink.

### API and persistence delta

- `POST /auth/register` returns `verificationDelivery: "queued"`.
- `POST /auth/email-verifications/confirm` consumes the raw token from the body.
- `POST /auth/email-verifications/resend` is authenticated by pending identity
  proof or an equivalent anti-enumeration challenge and is rate limited.
- Repository records: `email_verification_challenges` and `mail_outbox`.
- Unique/atomic constraints: one live challenge per user; one consumption; one
  outbox identity per challenge and template.

## 2. Chat write and pagination

### Human message write

`POST /chat/threads/:threadId/messages` accepts:

```json
{
  "clientMessageId": "client-generated UUID",
  "text": "non-empty user text",
  "agentId": "required selected repository Agent ID"
}
```

`agentId` is required in Wave 2. This operation always means "persist and run";
there is no agent-less variant. Missing/empty `agentId`, an unknown Agent, or an
Agent without an authorized published version returns `422` before writing either
a Chat message or an AgentRun. Plain human-only notes require a future, distinct
operation rather than an ambiguous response shape.

Authorization is repository-scoped and thread-scoped. The idempotency identity
is `(threadId, actorId, clientMessageId)`. An identical retry returns the same
human message and `agentRunId`; a changed payload returns
`IDEMPOTENCY_CONFLICT`. Persist the human message before creating the run, in one
application transaction or a transactional command/outbox with equivalent
atomicity. A successful request returns `202` with the durable human message,
created `agentRunId`, and `runStatus: "queued"`; it never fabricates an inline
assistant reply. At acceptance the server resolves the Agent's published immutable
version, including its ordered Skill version IDs and fixed model, and records that
exact snapshot on the run. Clients cannot override Skill/model versions here.

### Stable list

`GET /chat/threads/:threadId/messages?cursor=&limit=` returns ascending messages
and `nextCursor`. The opaque cursor encodes `(createdAt, messageId)` and queries
use the same tuple ordering, so identical timestamps do not skip or duplicate
rows. The default and maximum limits are 50 and 100. Messages inserted after a
page may appear on a later page; already returned identities never repeat.

Agent messages carry `agentRunId` and `replyToMessageId`. Human messages carry
`clientMessageId`. The database enforces the respective uniqueness constraints.

## 3. Skills persistence and explicit import

### Model

- `skills`: repository-owned logical identity, name, status, creator, timestamps.
- `skill_versions`: immutable version identity, semantic label, content digest,
  manifest, creator, created time; published rows cannot be mutated.
- `skill_version_files`: version ID, normalized relative path, content/blob
  reference, media type, digest; each version contains exactly one root
  `SKILL.md`.
- `skill_mounts`: repository/project target, immutable version ID, mount path,
  enabled state, actor, timestamps; mount path is unique per target.
- `starter_pack_imports`: pack ID/version/digest, idempotency key, administrator,
  import time, result IDs, and failure status.

Every AgentRun stores concrete `skillVersionIds`; it never resolves a mutable
"latest" version after acceptance.

### Explicit starter-pack import

`POST /admin/skills/starter-pack-imports` accepts `{ packId, packVersion,
idempotencyKey }` and requires an administrator principal. The pack manifest and
each file digest are verified before one all-or-nothing transaction creates the
Skill/version/file records and provenance. Identical retries return the original
result. A conflicting name or changed payload fails visibly and never overwrites
user content.

Runtime startup, migrations, bootstrap, fixtures, project enrollment, and first
login **MUST NOT seed built-in skills**. An empty repository remains empty until
an authorized administrator invokes the explicit import operation. Tests may
create fixtures only inside isolated test databases and must not share that path
with production bootstrap.

## 4. Agent persistence and explicit import

### Model

- `agents`: repository-owned logical identity, stable name, status, creator, and
  timestamps.
- `agent_versions`: immutable version identity, Agent ID, instruction/config
  digest, ordered `skillVersionIds`, fixed `modelProvider` and `modelId`, empty
  Wave 2 tool policy, creator, and created time.
- `agent_starter_pack_imports`: pack ID/version/digest, idempotency key,
  administrator, import time, result IDs, and failure status.

Publishing appends a version; it never mutates a prior version. An Agent has at
most one published head, selected atomically, but existing runs keep their stored
version ID. Resolving `agentId` for Chat requires repository visibility, enabled
status, and a published version whose referenced Skill versions exist and are
authorized in the same repository.

### Separate explicit Agent import

`POST /admin/agents/starter-pack-imports` accepts `{ packId, packVersion,
idempotencyKey }` and requires an administrator principal. This is deliberately
separate from `POST /admin/skills/starter-pack-imports`: import Skills first,
then Agents whose signed manifest references concrete imported Skill version IDs
and digests. Missing/mismatched Skill versions fail the entire Agent import.

The Agent pack signature/digests are verified before one all-or-nothing
transaction creates Agent definitions, immutable versions, published heads, and
provenance. Identical retries return the original result. Name/content conflicts
fail visibly and never overwrite user-created Agents.

Runtime startup, migrations, bootstrap, fixtures, project enrollment, and first
login **MUST NOT seed built-in Agents**. A repository has no common Agents until
an authorized administrator explicitly imports an Agent pack. Test fixtures stay
inside isolated test databases and cannot reuse production bootstrap paths.

## 5. Minimal no-tool AgentRun

### Acceptance and snapshot

The Chat write application resolves the required `agentId` through the durable
Agent repository created by #417, then creates a run with immutable
`agentVersionId`, ordered `skillVersionIds`, `modelProvider`, `modelId`,
`threadId`, and `inputMessageId`. The server authorizes every referenced version
at acceptance. Wave 2 permits one configured provider and does not fall back to
another provider/model.

The run status machine is:

`queued → running → writeback_pending → succeeded`

Failures from any non-terminal state transition to `failed` with a stable,
redacted error code. Run steps are append-only: `accepted`, `context_built`,
`model_called`, and `chat_writeback`. Each records status, start/end time, input
and output digests, and a redacted failure code. Prompt and response retention
follows repository privacy policy; logs never contain credentials.

No tool registry, MCP invocation, approval wait, recovery graph, SSE transport,
or secondary model provider participates in this slice. Polling is the Wave 2 transport.
`GET /agent-runs/:runId` returns the authorized run, ordered steps,
terminal error, and `resultMessageId` once durable. Clients use bounded backoff
and stop at a terminal status.

## 6. Idempotent Chat writeback

After the sole model call succeeds, the executor stores the model output and
enters `writeback_pending`. The Chat writeback operation atomically inserts one
assistant message with `(agentRunId, replyToMessageId)` and records its ID on the
run. A unique `agentRunId` constraint makes retry return the existing message.
Only after that transaction commits may the run become `succeeded`.

If writeback fails, the run stays non-terminal for bounded retry and never emits
a synthetic success message. Exhaustion produces `failed` with
`CHAT_WRITEBACK_FAILED`; the human message remains visible and the UI offers an
explicit retry that creates a new run linked to the same input message.

## 7. UI delta

These are proposed test IDs for implementation; they do not claim that the live
UI already provides the behavior.

| Screen | Required states/actions | Stable selectors |
| --- | --- | --- |
| `/auth/register` | delivery queued, resend pending/rate-limited/failure | `registration-verification-queued`, `registration-verification-resend` |
| `/auth/verify-email` | consuming, completed, invalid/expired generic | `email-verification-pending`, `email-verification-success`, `email-verification-invalid` |
| `/chat/live` | durable compose/send, paged messages, run polling/failure/retry | `chat-live-composer`, `chat-live-composer-input`, `chat-live-composer-send`, `chat-live-message-list`, `chat-live-run-status`, `chat-live-run-retry` |
| `/skill/live` | honest empty state, version/file view, mounts | `skill-live-empty`, `skill-live-version`, `skill-live-files`, `skill-live-mounts` |
| `/admin/skills` | explicit import confirmation, progress, conflict/result | `skill-starter-import`, `skill-starter-import-confirm`, `skill-starter-import-result` |
| `/admin/agents` | honest empty state; separate Agent pack import after Skills; dependency/conflict/result | `agent-live-empty`, `agent-starter-import`, `agent-starter-import-confirm`, `agent-starter-import-result` |

AgentRun has no top-level Wave 2 screen. Its progress and terminal result are
embedded in Chat. UI must not show a successful reply until it can read the
durable assistant message.

## 8. End-to-end dependency order

1. Human signs this delta packet.
2. #411 email confirmation and mail outbox may proceed independently.
3. #415 Chat persistence/write/pagination and #412 Skills persistence/import may
   proceed in parallel after signoff.
4. #417 Agent persistence/import depends on #412 because Agent pack manifests
   reference already imported immutable Skill versions.
5. #414 minimal AgentRun depends on #415, #412, and #417.
6. #413 Chat writeback depends on #414 and #415.
7. The existing verify:full work in #387 integrates all completed children and
   is the release-readiness gate. Feature tests passing alone are not equivalent
   to end-to-end readiness.

No child may infer approval from its predecessor's implementation; the pending
human signoff is a shared prerequisite.

## 9. Screen-to-repository responsibility matrix

| Slice | Screen | Web adapter | API/controller | Application | Repository/external boundary |
| --- | --- | --- | --- | --- | --- |
| Confirm email | `/auth/verify-email` | auth HTTP adapter | confirm/resend routes | confirm challenge, queue resend | challenge repo + mail outbox + mail transport worker |
| Chat write/list | `/chat/live` | Chat HTTP adapter | POST/GET messages | authorize, dedupe, persist, enqueue run | message repo + run command/outbox |
| Skill library | `/skill/live` | Skills HTTP adapter | Skill/version/file/mount routes | immutable publish and mount | Skill/version/file/mount repos + blob store |
| Skill import | `/admin/skills` | admin Skills adapter | admin Skill import route | authorize, verify Skill pack, transact | Skill import provenance + Skill repos |
| Agent catalog/import | `/admin/agents` | admin Agent adapter | Agent list/version + admin import routes | resolve published version; verify Agent pack after Skills | Agent/version/import repos + Skill version repo |
| Run status | embedded Chat card | AgentRun polling adapter | GET run route | authorize and project steps | run/step repos |
| Reply | embedded Chat stream | Chat polling adapter | GET messages | idempotent writeback | message + run repos in one transaction |

Every row must be exercised through its public boundary in the full journey;
direct repository calls alone are insufficient acceptance evidence.
