# Local direct negation boundary (#5432)

The observed synthetic report (SHA-256 26493f1bd138684f703938d00fd8a41394ed0b551a4db522745eabd0282b4b6a) contains the denial `不断言最常见、极高风险或某条件必然阻止购买` at UTF-16 [1571,1592). The old strength gate rejected this direct denial while accepting equivalent `不得断言`/`不能断言` forms.

RED: three direct-denial regression cases failed before the production edit. GREEN: 390 interview Markdown unit tests pass after narrowing the new rule to the observed finite predicate coordination. Positive statements, contrast turns, double denial, unrelated objects followed by `事实是`/`且已证实`/`且已确认`, and distant scope remain rejected. An earlier broad length-bounded expression was rejected by independent review and removed.

This is validator-only evidence. It does not certify the whole observed report: unsupported single-QA metadata remains a separate concern, and the real normal-output acceptance count remains 0/3. No real model was called for this change. Raw bytes, source locators, source hashes, CAS and model call caps are unchanged.
