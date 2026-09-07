# Standard capabilities implementation handoff

Worktree: `/private/tmp/workspacex-standard-capabilities`; branch `codex/standard-capabilities`.
Tracking issue #2864; single aggregate Draft PR https://github.com/boardx/workspacex/pull/2869 .
User explicitly authorized pushing this development code and test documentation to public
`boardx/workspacex` and updating that PR. Do not merge into main. Temporary module-agent
identity waiver and aggregate PR exception remain in effect; do not invent registrations.

## Current state

Latest main d30ac48e8 (peer PR #2890) integrated in 02f6b5c8c. Independent increments: credential broker 41d60d32f; running cancellation with real LangGraph confirmation 5068ecb0a; uploaded WAV to artifact chain e2cb7a80a; CI Python/TLS/scheduler fixes 246b2d9f4. Last successful push f1ecb4734; later commits need pushing and current-head CI. No merge into main.

Integrated working-tree API typecheck and 58 tests passed; see evidence/ci/main-d30ac48e8 for pending increments present in that run. All own root DB resources cleaned.

## Active work and ownership

Root owns git, shared kernel/factory, docs and integration. All three workers are active:
- claude_research: committed WAV chain; now FFmpeg image/decoder and real 60-minute probe.
- current_runtime_audit: committed credential broker; now organization indexed FTS/citations with explicit coverage and per-source authorization.
- langchain_research: committed running cancellation; now scheduler notification API/UI/delivery integration.

Workers coordinate the DB slot directly. New independent work continues while root reviews/commits. Never revert another worker's changes. Remaining browser, delegated file access, full retrieval/rerank, document locators, audio duration/formats, compatibility, live-model acceptance and final CI are not complete.

## Peer

Task agent ux dev: 01a07700-7c3c-7402-9855-d7dc9f9fcf5e, host local, PR #2890.
Initial direct request/reply succeeded. Preserve peer deny priority and atomic cancel
winning pause (integrated 1eb5f732c / a8d47eb89), plus native session cleanup 50b9d9a40.
Later desktop task tools returned Transport closed; do not claim undelivered messages
were received. Read peer-boundaries.md for exact division. Do not rebuild their workbench,
main-run queue, approvals or journal. Durable scheduled-run notification is an open port.

## Verification discipline

API tests use `.harness/scripts/with-test-isolation.ts`, one DB wrapper at a time; coordinate
with workers. Run tool commands requiring local IPC/network with normal approved sandbox
escalation, never bypass hooks. Native sandbox uses the session compose with mandatory
seccomp and init reaping, unique owned names and cleanup. Never stop other agents' stacks.
Use existing Python .venv and lock. Do not upgrade Deep Agents casually or substitute
in-memory state. Preserve raw failures and corrected reruns. Publish only current-head
CI conclusions; old green checks do not transfer to new commits. Never mark unfinished
capabilities passing or claim public deployment from local tests.
