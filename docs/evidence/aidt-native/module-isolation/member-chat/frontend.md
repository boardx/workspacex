# Project member text channel frontend

Implemented independently of AIDT and AI Chat. The backend contract is `@repo/contracts/project-member-chat`; no AgentRun or model transport is used by the live component. The global launcher is owned separately and must keep its selected `ProjectMemberChat` instance mounted across project switches to retain in-session project draft partitions.

## Delivered behavior

- Independent `NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT=true|1` opt-in, default off. No service request when off, unauthenticated, inactive or document hidden.
- Five-second foreground deltas, immediate catchup on reopening, online and focus. The client applies `nextAfterSequence`, drains bounded pages, merges by authoritative IDs and shows older-topic reply updates even when their roots were outside initial history.
- Root channel and single-level topics use project-authorized backend reads. Replies retain their real root. Channel and per-topic drafts remain separate.
- Server storage receipts are authoritative; pending and unconfirmed messages retain original text. Retry uses the identical immutable request and clientMessageId. Conflicting IDs are not silently replaced.
- Explicit identity token on every request; token epochs and org/user/project scopes reject late reads and isolate late send receipts. Authorization is rechecked before cached history is shown after project/token changes. Denied access removes visible history; ordinary transient errors preserve previously authorized history and drafts.
- Backend `canWrite` and `readOnlyReason` govern composers and retry controls. Archive, organization read-only and role read-only do not post.
- Stage references are opt-in per message, never inferred from discussion text or promoted to a saved learning outcome. No unread/read receipt, notification or voice promises.
- Plain React text rendering; native UI tokens, keyboard/IME behavior, copy, thread focus return and scroll-to-latest behavior. No AI message renderer or model SDK in the live entry.

## Local validation

`pnpm --filter web test tests/ui/project-member-chat.test.tsx tests/live-project-member-chat.test.ts tests/ui/team-text-conversation.test.tsx`

35 tests passed: controller 19, contract adapter 10, retained preview 6. Tests mock HTTP and session identity; they verify client behavior, not live service connectivity. Covered delayed cross-actor/project responses, rotated token reauthorization failure, stable retries, server receipt deduplication, read-only/archive behavior, explicit stage context, real root reply routing, old-root delta access, paging watermarks, offline draft preservation, paused background polling, both authorized project-directory routes, directory-denial fallback, and late cross-project name isolation.

Targeted ESLint and `git diff --check` passed. Full workspace typecheck is coordinated by the parent agent. Real isolated PostgreSQL/two-account browser acceptance is performed by the compatibility agent; no live backend, microphone, production or deployment success is claimed here.

## Current boundaries

Author labels use real displayName values from the existing project-authorized members directory. Workshop members are read directly; only an explicit members:null response selects the existing non-workshop collaborators route. Directory denial never falls back to an organization roster. Names are optional metadata: failure retains usable messages with `我`/`小组成员`, with actual authorId available in an expandable disclosure. Late cross-project directory responses are ignored. Drafts are memory-only for this authenticated page session, not durable server messages. Background push, notification delivery, read receipts, voice rooms, realtime simultaneous draft merging and file messages are outside this slice. Five-second HTTP polling is not peer-to-peer transport.

## IME regression: Safari confirmation Enter

The original live member chat and retained text preview both sent on `Enter` when `isComposing:false` and `keyCode:229`. An actual-component counterexample reproduced an unintended live POST and an unintended preview onSend (two failing tests; `/tmp/aidt-member-ime-before.log`).

Both human composers now share `isMemberChatComposing`, which checks `event.isComposing || event.keyCode === 229`. The same tests pass after the fix, retain the original text on IME confirmation, preserve Shift+Enter and composing Enter, and permit one ordinary Enter send. Canonical AI composer was not changed. Full targeted run: 34/34 passed (`/tmp/aidt-member-ime-after.log`).

## Topic context stays outside reply scrolling

A native browser screenshot review found that a reply could scroll its root message out of view. The root now appears once in the topic header outside the scrolling reply log, with a two-line summary and an accessible expand/collapse control for bounded full original text. The reply log contains replies only. Root identity and send/draft/access logic remain unchanged.

A real-component test with 30 long replies verifies that the root summary is outside the reply log, retains its root ID, has exactly one original-text element, remains structurally separate after a scroll event, and expands without duplicating root text in replies. Targeted suite: 35/35 passed (`/tmp/aidt-member-topic-fixed-tests.log`). Browser geometry is delegated to the fresh native screenshot validation; jsdom does not validate actual viewport placement.
