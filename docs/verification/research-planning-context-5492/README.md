# Planning payload scope — #5492

The private brief generation asked for goal/focus/time/region that the service discarded in favor of original user scope. It now requests only a topic and validates the reconstructed full brief with the existing public draft and generated-topic rules. Legacy complete brief responses remain compatible. Explicit original topic and up to 40000-character goal/focus remain authoritative.

Brief and direction generation inputs contain the complete original brief and explicit instruction, without unrelated old source/report/task/message bodies. Outline input continues to include every enabled direction. Public manual drafts and conversational proposal output shapes remain unchanged; generation order, retry skips, model dispatch count and cancellation behavior remain unchanged.

Two regressions failed against the original implementation. Focused three-step tests: 35 PASS including six invalid topic payloads, original long-scope preservation and previous-body exclusion. Full pure API: 26 files, 573 PASS. API TypeScript and lint exit 0. Independent review exact35710d200 accepted, 48 focused design/three-step tests PASS. No production latency improvement or formal report success is claimed.
