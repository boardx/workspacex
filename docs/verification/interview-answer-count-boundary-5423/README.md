# Unavailable question-answer count (#5423)

The failed real report9904741510f98bf9a56024848657c30c5d1cf67a incorrectly called each task a single question-answer. This is a separate content error; the actual grounding rejection was unsupported_evidence_strength from copied system constraints (#5422).

Current canonical source contracts bind task output spans and text-line locators, not question-answer identity. A task, span, answer-N line anchor, Q heading or paragraph count cannot determine question-answer count. The report context now marks that count unavailable and instructs the writer to omit it, retaining the existing verified task/persona counts and simulated boundary. No inferred two-answer count, human evidence claim or parsing heuristic is introduced.

Regression uses bound and legacy sources with two apparent Q headings/four indexed lines: count stays unavailable, verified task/persona count stays respectively1/1 or0/0. RED2/374 ->GREEN374/374, API typecheck passed. Command: `pnpm --filter @repo/api run test:interview-markdown-unit`.

No gate, source identity, CAS, attempt limit, retry/fallback or API contract changes. Real-model/browser validation remains pending; zero normal complete reports have passed the current three-round acceptance.
