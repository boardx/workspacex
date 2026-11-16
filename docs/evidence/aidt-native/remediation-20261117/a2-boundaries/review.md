# A2 independent read-only boundary review

Reviewed 2026-11-17 (Asia/Shanghai), repository HEAD `370c7328f`. This is an agent code review of A1 runtime convergence and A3 summary projection, not human teaching sign-off, a real-model result, or a claim that the current runtime is deployed. No model, stack, database write or production edit was performed for this review.

## Finding R1 — a successful feedback result can hide another tool outcome

**Priority:** P1 before accepting mixed-tool/error/HITL recovery behavior. **Owner:** A1 runtime convergence. **State:** reported to owner and root; not reproduced in a live graph by this reviewer.

At review time, `apps/deep-agent-service/src/deep_agent_service/harness.py`, `_completed_feedback_message` (lines 1289–1317), searches backwards for a successful `call_skill` carrying the internal artifact. It checks the mounted content digest, complete task/result digests and exact call ID. It rejects a later student message. It does not, however, reject another later failed/rejected tool result, another pending tool call, or an earlier failed sibling in the same tool-call batch before returning this successful result.

The concrete counterexample to test is one assistant batch containing a valid opted-in `call_skill` plus another tool: the focused Skill succeeds, but the sibling fails or yields a rejected-tool result. On the next model hook, the branch can still find the Skill success and return its text as the final answer without representing the other outcome. A second counterexample is a new assistant tool call after the success which has not yet acquired its matching result. The exact successful Skill call is not sufficient proof that all other pending work is safe to discard.

A genuine graph interrupt usually prevents entering this model hook until recovery; this review does **not** claim that pending HITL was bypassed in a real run. The missing controls concern mixed batches and recovery-result interpretation. Add an adversarial graph/unit case for these sequences, preserve ordinary/error/unknown behavior, and require an appropriate terminal tool batch before direct return. Do not solve this by treating denial as success, widening permission, or automatically retrying paid operations.

## A1 controls that were present

- The precise marker `<!-- aidt-feedback-turn: return-after-student-feedback-v1 -->` is recognized only as the first nonblank body line of the actual mounted Skill content. User-message text or a marker in a later example does not activate the policy.
- The marker is a behavior opt-in, not authorization. Mounting and HITL retain their existing paths. Only new immutable methods 1.3.1 / summary 1.0.1 include it; old published bytes and pins remain unchanged.
- The internal success artifact binds the full mounted content, task and result bytes. Unknown Skill, provider exception and empty response do not acquire that artifact. A changed mount, changed task/result, mismatched call ID, new student action or mid-run interjection is checked by existing regressions.
- Exact server reference messages are injected from graph state into the focused call, rather than accepted as a model-visible argument. The new fallback excludes the outer orchestration system prompt; it does not grant access to any additional project or source.
- Stopping a feedback turn means waiting for students. It does not set stage completion, student confirmation, evidence validation, all-member consensus or a saved-file receipt.

These are source observations. The included fake-provider graph tests establish orchestration only, not supplier-model teaching quality. No independent rerun was performed as part of this read-only review.

## A3 summary projection — no additional blocker found in the reviewed paths

Reviewed `apps/api/src/application/aidt-run-context/summary-excerpt.ts`, `prepare.ts`, their targeted source tests, and the read-only source-review presentation in `apps/web/features/aidt/lib/aidt-summary-results.ts`.

- The projector uses exact saved revisions, preserves original input objects, expands permitted JSON reference fields as data and labels the projection `saved-field-excerpts-not-full-source`. It preferentially retains the verification question, V1/V2 references, prior/post-test understanding and historical/current return decisions.
- Every summary source is marked `truncated`, even when the selected short fields fit. Omissions disclose field excerpting, omitted paths, partially clipped paths and a possibly shortened path list. Empty excerpts are explicitly identified. The snapshot still declares original file bytes unread, teacher comments without a source, personal artifacts not included, and lineage unknown.
- The final framed/escaped UTF-8 message and aggregate history character limits are checked after projection. The retained exact revision coordinate is not presented as evidence that its full saved object or original attachment was read.
- `modelReferenceBlockHash` hashes the actual projected reference block. `snapshotHash` and selector coordinates bind the frozen software input; they do not establish model understanding, truth of student claims, a complete source read, or research success.
- The report import separates the software source-scope record from unchanged AI text. Missing receipt means unknown scope; a dispatch receipt does not claim correct coverage by AI. Existing report/AI prose is not silently rewritten into a passing result.

The original SUM defect must remain accurately described: the report did include the current step-5 return choice. It omitted historical return-to-step-2 → later step-5 evolution and visible V2 treatment, and failed to disclose the overall truncated scope. The old S6 V4 reason was unread in a 15-byte excerpt; current V7's V2 reference and return choice were visible. Source projection should support a new honest report, not retroactively make the old report complete.

## Follow-up acceptance

Root/A6 will provide frozen inputs and actual model replies for S2/S3/SUM. Semantic review must compare those actual sources with the reply, checking simulation/practice boundaries, exact source categories, student decision ownership, the valid “暂无” branch, source-scope disclosure and version/return history. If content still deviates, report the deviation; do not reinterpret a successful request, saved object, exported file, or later student correction as original-model teaching acceptance.

## Actual S1 semantic review — one source question, with a framing defect

**Actual evidence:** [S1 actual turn](../a6/s1-actual-turn.json), run `cc29fef8-3cb3-4cc4-8969-2df5e2e2631a`, selected S1 revision 1, new mounted Skill version `skill-version-f0620b1c-06a4-48e5-997c-2e7aecf2f40c`. The JSON contains the actual student request and reply. The setup in `apps/web/e2e/aidt-v2-completion.spec.ts` saves `guess`, no observation/interview quote, and expressly leaves whether the difficulty exists unknown. Source/UI receipts agree on the frozen snapshot and show `message-dispatch-observed`; they do not prove provider understanding or research truth. This review did not send another model request or change the saved evidence.

The request was: “只追问一个帮助学生澄清问题来源的问题”. The bold reply asks:

> 你们最初为什么会想到“新同学在食堂看不懂分区牌”这件事？是因为有人亲口抱怨过、你们自己亲眼看到谁找错过位置，还是大家凭经验觉得“应该会有人搞不清楚”？

### Question focus

These are two interrogative sentences but one response task: describe where the initial research idea came from. The second sentence supplies concrete source categories for answering the first. It does not ask students to perform a second independent activity such as choose a solution, synthesize interview evidence, rewrite the topic, or generate a prototype. Thus a strict `ONE_FOCUSED_QUESTION_REQUIRED` failure based only on two question marks overstates this defect. The valid semantic check is one focused source clarification, with optional examples/options that do not become additional required tasks. Do not remove the substantive one-focus requirement merely to turn this run green.

### Premise fidelity

A separate defect remains. The stored initial topic is “如何让新同学理解食堂取餐指示”, while its activity field explicitly says “困惑是否实际存在仍待讨论”. The reply changes this to a quoted “新同学在食堂看不懂分区牌”. That negative formulation narrows the student's open understanding question into a proposed deficit and is not an exact quotation of their topic. It can prime students to explain a difficulty whose existence is still unknown. Future wording should preserve the original topic or explicitly label any proposed negative formulation as an optional hypothesis, not put it in the student's mouth.

The complete reply does **not** claim this deficit is verified: its opening correctly says the source is guess, there has been no actual observation or human interview, and whether any difficulty exists is unknown. Its closing says not to treat the difficulty as already established. It neither creates participant quotations nor saves/confirms a stage, and it waits for students' own accounts. Consequently this is a real framing/quotation-fidelity defect, not a demonstrated fabricated interview or claim of proven user difficulty.

**Judgment:** the single-source-question and student/evidence boundaries are substantively met in this turn; a punctuation-only focused-question assertion is not a sound reason to fail or rerun it. Record the inaccurate negative paraphrase as a remaining quality defect. Do not label this reply “zero deviation”, erase the earlier QA failure, infer full FR15 value-question coverage, or credit a later student correction to the model. Preserve this run and continue independent tests; a wording fix and its later verification should have their own evidence rather than a gratuitous repeat paid request.

## R1 follow-up — narrow source fix inspected

After the finding was reported, A1's owner supplied a root-authorized narrow fix. Independent reread confirms `_completed_feedback_message` now selects the **latest** assistant tool-call batch, requires exactly one `call_skill`, requires exactly one matching successful tool result after it, and then applies the mounted-byte/task/result binding. Mixed batches, another latest pending batch, unpaired/duplicate results and failed results fall back to the original handler rather than searching backward for a convenient earlier success.

The owner added explicit mixed error/denied/unknown/success/pending and later-batch/duplicate-result counterexamples, plus a real graph with a fake provider that must deliver an unknown-tool error to the outer model. Owner-reported verification is 41 feedback tests passed and combined 217 passed / 2 skipped. This reviewer inspected the new code and test cases but did not independently rerun them. The original R1 observation above remains a record of the pre-fix state; deployment, actual-stack results and cancellation/HITL acceptance belong to their respective live evidence, not this source review.
