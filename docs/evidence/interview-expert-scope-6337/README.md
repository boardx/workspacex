# Interview expert scope and transcript projection — #6337

## Reproduction and cause

Read-only CN browser inspection reproduced two saved expert tasks. The transcript contained a linked security-expert heading, a linked DevOps heading, then an unlinked H1 security-expert heading and the same four security questions inside the DevOps output. This is generated peer content inside one task, not a second server task for the same person.

Each expert previously received all confirmed expert profiles and outlines. Every retry also received the entire runs Markdown, including completed peers. This creates both source and continuation ambiguity.

## Change

- Model-only context projects only the current expert’s sections from confirmed experts/outline Markdown; shared intake/analysis, actor authorization and source-version checks remain. Missing own section fails rather than falling back to other experts.
- Retry extracts only spans attributed to the current task’s expert, with full document and fragment integrity checks. Completed peer content stays stored and is not resent as a failed expert’s continuation.
- Transcript-only display removes leading generated notices and an explicitly named peer’s copied top-level section. It resumes at the next expert wrapper or current expert name; ordinary insight headings cannot resume a foreign section. Insight cards use the same read-only projection. Fenced examples, substantive answers and canonical Markdown/versions/hashes/evidence modes remain.
- The model is instructed to answer only its current expert and omit repeated titles/notices. No production data is rewritten or regenerated.

## Verification

RED observed: current expert model context includes a peer’s profile/questions; retry receives completed peer content and fails the new strict provider fixture; duplicate title/questions/notices remain visible; copied same-level insight is attributed to the wrong expert.

GREEN: controlled API context5tests, actual PostgreSQL execution/context17tests, interview unit lane465tests, related web3files41tests; API/web typecheck and API lint passed. Independent review caught the same-level insight edge; regression added and reviewer confirmed the fix with no remaining P1/P2.

Full PostgreSQL interview suite attempted with2workers: a fixture INSERT in virtual-real-counts-split.test.ts deadlocked (629tests passed before bail). This is not a passing suite; serial rerun result recorded in PR. No production DB was used. Test stack is owned by this task and will be removed after verification.

The CN browser inspection was pre-fix diagnosis. No authenticated post-deploy browser evidence or real-provider generation has been claimed. The current branch requires PR checks and release before it affects CN.

Final full serial database regression:87files passed,1050tests passed/1existing skip,164.87s, peak25connections. API/web typecheck, API lint and git diff --check passed. Owned interview6337 PostgreSQL container/network removed with compose down.
