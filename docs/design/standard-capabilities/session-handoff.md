# Standard capabilities implementation handoff

Worktree: `/private/tmp/workspacex-standard-capabilities`; branch `codex/standard-capabilities`.
Tracking issue #2864; single aggregate Draft PR https://github.com/boardx/workspacex/pull/2869 .
User explicitly authorized pushing this development code and test documentation to public
`boardx/workspacex` and updating that PR. Do not merge into main. Temporary module-agent
identity waiver and aggregate PR exception remain in effect; do not invent registrations.

## Current state

Read development-flow.md for scoped component progress and capability-catalog.json for
all 75 original requirements. Progress colours do not mean harness passing or deployment.
Latest committed implementation at this snapshot: f51283005. Last successfully pushed:
50c6eac902d8c15a86a45f0a9589646f9a810b55. That push passed 13 local checks. Current PR
snapshot is Draft / DIRTY, no current CI results. merge-tree preview found one conflict
in apps/deep-agent-service/Dockerfile against fetched origin/main; preserve both changes
when integrating main into this feature branch after worker edits are committed.

Native factory/session persistence and recovery, actual Skill events, per-tool authority,
readonly authorized attachment inputs and output staging/writeback are implemented.
W12 uses LangMem and a persistent Postgres Store with identity, visibility and cancellation
checks. E005 anonymous approved MCP execution is now integrated (0872c9b3d); credential
broker and isolation acknowledgements remain in development. These replace the older
handoff's assertions that there was no native production path or memory/MCP consumer.

Recent committed components: W17 official SQL and cancellation 7d42283e3; W08 text
7d1126261 and bounded OCR 50c6eac90; platform complete-pack seed 5aba6a788/d3c1c8c03;
JSON artifact staging a1dcaf4dc; full Skill draft/artifact/admin import chain f51283005.
Evidence directories preserve actual commands and limits. No real-model or full UI
acceptance is implied by scripted-model and DB/HTTP component chains.

## Active work and ownership

Root owns git staging/commits/push, progress documents, platform seed, and main integration.
Three parallel workers share this worktree; never revert another worker's edits.
- claude_research: W14 standard image generation using existing Bailian provider,
  guarded image download, sandbox validation and complete Skill; audio remains later work.
- current_runtime_audit: E005 sealed credential broker and MCP isolation/acknowledgements;
  browser integration follows. Anonymous execution is already committed.
- langchain_research: W13 official pg-boss scheduler, now production composition. Worker
  temporarily owns kernel.module.ts/native_factory.py and related profile wiring.
  Provider/service tests passed; missing durable notifier rejects create. No fake notifier.

Remaining requirements include running subtask cancellation and public events, delegated
file authority, broader retrieval, cross-page tables and Office locators, audio Skills,
compatibility/deployment verification, joint real-model E2E and current-head CI/review.
S015 platform seed addition is in progress; its complete package is already committed.

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
