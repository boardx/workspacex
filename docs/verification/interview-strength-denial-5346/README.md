# Scoped prohibition of unsupported statistical claims (#5346)

Base fresh main cbbc8162eb8711fec25a02079e4e5b57001f44ab, after #5348 merge. The public report's “不能凭空补充样本统计来断言预算约束必然阻止购买” prohibits an unsupported causal claim, but the finite strength gate incorrectly rejects it.

Three direct prohibitions reproduce RED (3 failed/225 passed). Minimal fix recognizes only an adjacent prohibited statistics-invention → assertion predicate chain, with the existing bounded subject interval. Explicit contrast, double denial and unrelated earlier prohibitions do not qualify. Ten unsafe counterexamples continue to reject, including comma/Chinese and ASCII semicolon, contrast, affirmative clause, double denial and positive claims. Controlled API six files 228/228 GREEN.

Logs red.txt and green.txt. No model calls, raw report rewriting or private incident access. This is a narrow grounding-parser correction, not overall semantic acceptance. #5327 and true semantic failures #5341–#5343 remain open; private original cause UNKNOWN. Exact independent review and current-head CI remain required.

## External1441 clause-splitting correction

External1441 advanced the PR with additional affirmative contrast controls. Root preserved it ff-only; main25 targeted ACCEPT and root232 suite passed, but independent review found valid local denial across “因而/从而” falsely rejected by the standalone “而” split. That acceptance is withdrawn as final release evidence.

Five direct local-denial regressions across causal/sequential 因而/从而/进而/继而 and additive 而且 reproduced RED5/235. Preserve these internal conjunctions; retain independent contrast/然而/反而/仍然 and comma/semicolon boundaries. Explicit affirmative 而且事实上/实际/确实 starts another assertion, so it cannot inherit an earlier denial. Three new affirmative controls and all external1441 controls still reject. Controlled six-file API240/240 GREEN; logs conjunction-red.txt/conjunction-green.txt. This changes no source/raw data or model output. New exact independent review and current-head CI required.
