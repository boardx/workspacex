# V2 acceptance preparation

Status: read-only code audit and test plan, not execution evidence. No V2 build or native service has been started. The final candidate must include the feature CSS scan fix; the earlier prebuilt runtime receipt is not valid for new source.

## Requirement source

Exact new requirements were supplied in `docs/requirements/aidt-v2-delta.md` and read by the QA worker. They identify FR15–FR19 and the additional input/output records. The source distinguishes the student's own confirmation from evidence verification, all-member consensus and server save. No new stage locks, voting rules, mandatory category quotas or service contracts are authorized by these changes.

Read baseline: Git HEAD `ab4c529551669bbe835de9239adc003682af3073`. Other owners are actively adding V2 implementation in the working tree; final results must identify the later frozen commit rather than label these observations immutable.

## Existing capabilities to reuse

| Capability | Actual code evidence | Acceptance implication |
| --- | --- | --- |
| Shared arbitrary text fields | `packages/contracts/src/aidt-stages.ts`: `draft.fields` is a record of strings, at most 100 keys, 6000 characters per value. `use-aidt-shared-stages.ts` clones the full draft and validates `StageContent` before PUT. | New teaching answers can use existing fields and CAS revisions; no new endpoint or database schema is necessary. Test exact values after a fresh login and native restart. |
| Preserved original research and discovery cards | `aidt-ui-drafts.ts`: separate headline kind, quote, interpretation/context, source and photo references. Real photo attachments retain the existing authorization check. | A new reflection should reference the actual card/source rather than manufacture an interview or silently equate a summary with a quotation. |
| Actual versioned save and conflicts | Existing shared-stage GET/PUT/history, expectedRevision, operationId and earlier-stage source revisions. `aidt-member-collaboration.spec.ts` already exercises two members, stale CAS, version history and project isolation. | Extend that harness only for new field round trips; preserve existing ACL, CAS and idempotency assertions. A student confirmation is not a server save receipt. |
| Stage-specific native Chat | `project-aidt.tsx` uses the canonical native Chat through the existing assistant panel; `aidt-chat-shared-context.ts` reads authorized server revisions. | Do not create a second Chat or claim model success in the no-model native local lane. Runtime Skill text and real model behavior require different evidence. |
| Full shared context payload | `loadAidtSharedChatContext` sends bounded `JSON.stringify(stage.content)`. | Generic V2 fields are not inherently dropped by this path. Test truncation and display labels separately. |
| Plain-text human communication | Existing global member chat and real message persistence. The native local test already saves a message, stops the runtime and reads it after a new login. | Every stage/branch keeps this shared plugin available. No AgentRun should be created by human-only text. Voice rooms remain deferred. |
| Group report persistence | Existing stage-six `summaryReport`, source version references, independent report save/conflict/restore. | Include new teaching records in the actual generated report; preserve existing report edits and source references. Missing facts must stay missing. |
| Native local persistence without fixture AI | `aidt-local-persistence.spec.ts` uses the actual local CLI, PGlite, login, group creation, real shared save and stored member message across stop/start. | Extend this same lane for V2. Missing local model/ASR remains explicit; do not replace it with a supplier fixture and claim real AI. |

## Concrete gaps found before V2 integration

1. `aidtUiStageSummary` and `aidtUiStageMarkdown` enumerate only `AIDT_OUTPUTS[stage].fields`. Unlisted new generic fields can persist but disappear from manual Chat handoff, readable previews and generated reports. Shared raw JSON context is a different path and already retains the data.
2. Shared save enablement and empty-draft hydration use the same summary function. A draft containing only an unlisted new field can be treated as empty or unsavable. Include a reflection-only/“暂无”-only save test rather than always filling an old field first.
3. Current stage-six teaching navigation links only to steps two through five. It does not express a student-selected no-new-prototype branch back to steps one through four.
4. Current stage-six output metadata names “迭代后原型” and lists `newVersion` unconditionally. A no-new-version decision must not produce a misleading “missing required prototype” conclusion, fabricated version, or automatic Design Workbench action.
5. Existing reports are derived from stage field metadata; they do not yet distinguish an explicit “暂无” from an unanswered field or an unverified AI inference. The generator must preserve the student's actual state and decision, including unresolved alternatives.

The new surprise-reflection component is visible as an in-progress owner change. It is not yet mounted/native-browser accepted by this worker and is not evidence that a numbered requirement is complete.

## Exact FR15–FR19 mapping

| Requirement | Baseline reusable behavior | Baseline gap / V2 acceptance |
| --- | --- | --- |
| FR15: study value and origin after initial problem submission | Original problem, assumptions and rewritten theme already exist and persist. | No dedicated value/source confirmation in the baseline. Exercise mixed observation/complaint/guess, concrete details, uncertainty and confirmation. A changed problem must not silently make an old reflection refer to the new problem; maintain an explicit relation or clearly invalidate it. |
| FR16: unexpected findings before persona | Stage-two discovery cards and real material references can supply the source; stage-three persona already distinguishes unknown information. | Add the pre-persona student reflection with explicit none/found. Found without a source can save as incomplete; none is a legitimate complete reflection and must not force an interview or fabricated finding. Preserve exceptions and contradictions. |
| FR17: easy / breakthrough / fun classification | The same idea ids, candidate descriptions, selectedIdeaId and selectionReasons already exist. | Add student-confirmed multi-label classification and reasons without mutating candidate selection or impersonating a vote. Empty category and unclassified idea are valid. A cross-listed idea remains one distinct idea for PDF readiness. |
| FR18: question and prior view before prototype generation | Prototype fields already capture selected idea, hypothesis, type, situation, task and actual version reference. | Student-defined question/prior belief/basis need explicit confirmation and a canonical snapshot. Incomplete drafts save, but generation stays unavailable. Edits invalidate old confirmation; actual version linkage cannot be fabricated. Static-image limits must remain visible. |
| FR19: changed understanding and chosen return step | Test sources, user words/behavior, inference, old/new version fields and report save already exist. | Add changed/unchanged/insufficient, evidence/uncertainty, explicit question snapshot and return 1–5/undecided. Returning 1–4 cannot require or generate a new version. Save the decision before navigation and preserve old/new records. Undecided can save and request teacher support without a fake notification. |

`draft.fields` stores the new values; it is not itself a teaching validation mechanism. Confirmation validity, JSON field parsing, allowed tag/state values and projection into readable outputs need UI/domain tests. The existing backend validates ownership/revision/text bounds; it must not be described as verifying research truth.

## Planned checks after exact requirement mapping and source freeze

| Scope | Positive path | Required counterexample |
| --- | --- | --- |
| Student-first input | Empty stage has no prefilled AI conclusion; student answers survive stage return. | Do not call generated suggestions a student confirmation or group consensus. |
| Reflection before synthesis | Record prior belief, observed finding, interpretation and a locatable source; explicitly confirm, save, reload. | Missing source/changed source stays a gap; changing a confirmed input invalidates the prior confirmation. |
| Explicit “暂无” | Select “暂无”, confirm and save even without inventing an observation; reload exact state. | Unanswered is not silently converted to “暂无”; no automatic score, forced interview count or invented surprise. |
| Prototype test intent | Store student-written question and prior belief associated with the actual prototype reference; carry into testing. | No automatic fake prototype/version; optional reference image is not required and is not research evidence. |
| Test reflection | Preserve actual user words, behavior and student interpretation separately; compare to the student's prior view. | No real test means still unverified; one observation is not universal validation. |
| New-version branch | If chosen, retain old tested reference, save the new reference and mark it awaiting testing. | Saving a new version is not a passed retest. |
| No-new-version branch | Save the student's reason and return choice; actual links to each of steps one through four retain project and earlier material. | No newVersion is manufactured or required; no generation request occurs solely because the student chose to return. |
| Shared and report projection | New field-only draft saves; all new fields appear in handoff/readable context/report with appropriate labels. | Unknown/none/unverified remain different; reports do not invent teacher comments or missing evidence. |
| Native visual CSS | Desktop heading is 20px/unclipped; assistant is absolute and max-width 448px. At 375px it is fixed and inside the viewport. | A Tailwind source-class string or jsdom render is not actual CSS acceptance. |
| Existing boundaries | Existing ordinary off-mode, project ACL, CAS and human-only text tests remain enabled. | New teaching content cannot bypass membership, archived read-only or overwrite another actor's revision. |

## Real API and native cases to add after owners freeze

### Native persistent local lane

Extend the existing real CLI/PGlite two-cycle test rather than create a fake backend. The original group creation, actual server receipt, human message, restart, fresh login and owned-port cleanup assertions stay intact.

1. **S1 origin:** enter a student problem, value and origin including guess; confirm and save. Check the actual GET draft fields and revision. Change the problem and verify the earlier reflection is not silently reinterpreted; preserve the original content in version history.
2. **S3 none-only:** enter only explicit none, confirm and save with no persona or invented interview. This catches summary-based save/empty-hydrate defects. Returning to the stage and then restarting the runtime must retain none, not turn it into unanswered or found.
3. **S4 tags:** create three distinct student ideas; set an explicit selectedIdeaId. Assign one idea both easy and fun, leave one unclassified and one category empty, record reasons, confirm and save. Verify selectedIdeaId and all candidate ids/content stay unchanged. A label edit invalidates classification confirmation without clearing the selected idea.
4. **S5 intent:** save an incomplete question draft without generation. Complete and confirm the question, prior view, basis and limitations. Compare the canonical confirmation snapshot with actual values; edit an input and require reconfirmation. Save actual prototype reference only if a real existing prototype is available; otherwise preserve the missing reference and do not claim a generated file.
5. **S6 snapshot:** explicitly import the current saved S5 question/prior view/reference into S6; save the copied snapshot. Save changed, unchanged and insufficient as different student states with their actual reasons or missing evidence. Edit S5 afterward and verify S6's prior snapshot stays unchanged until an explicit new import.
6. **S6 return branches:** save return to steps 1, 2, 3 and 4 with reason/action/next question and an empty newVersion, then use the corresponding actual navigation links. Each must keep projectId, retain saved earlier work and leave no generation request. Test return5 separately as a prototype iteration path; test undecided as a saveable unresolved choice with no automatic route.
7. **Report and human plugin:** generate the actual report and assert all five records are represented with none/unchanged/insufficient and missing-material labels intact. Save the report. Global human text remains usable from S1/S6/report; no human-send action triggers model activity.
8. **Restart:** after real stop/start and new login, read every saved stage through both UI and actual API; compare new fields and report exactly to server receipts. Distinguish shared record save from a student confirmation or teaching completion.

The no-model local runtime can establish the form, gate, persistence, raw context and navigation behavior. It cannot prove the model follows the new Skills or generates a valid static prototype. Skill package loading/schema tests and a separately configured real-model lane remain separate evidence.

### Existing seeded two-actor/ACL lane

- Store the exact V2 field sets through the existing shared-stage PUT and inspect persisted content plus history; retain the real source revision graph. Do not put stage-six formal source references into stage one: the contract only accepts earlier-stage references.
- Two actors editing different reflection/return values from the same head must get one committed save and one 409. The loser retains its local text and must review the current server base; no silent merge or confirmation resurrection.
- Existing admin-nonmember/cross-project/observer/archive cases retain their denial/read-only behavior for V2 writes. Raw fields do not gain an authorization bypass.
- A malformed JSON tag/snapshot/card-id string is valid plain text at the generic API layer, so the client must show an invalid/unconfirmed record rather than crash or convert it to a valid choice. Do not claim backend semantic rejection unless it is explicitly implemented.
- Changing a current S5 question must not rewrite an already saved S6 snapshot/report or earlier immutable revisions. Fetch actual revision history to prove preservation.
- Existing human-only message delta/idempotency tests still run; no new endpoint, table or provider fixture is added for these teaching fields.

## Final execution plan

After the coordinator freezes the combined V2/UI/Skill source, run one new actual native production build and the persistent two-cycle test. Use a newly verified receipt; do not reuse the earlier CSS-incomplete receipt. Parent `NODE_ENV=development` remains the inheritance counterexample while actual web mode must be `start`.

The opt-in cache trim is test-only: wait until build owner releases, acquire the existing output lease, verify receipt true, delete only the generated `cache` directory, verify receipt/PG digest unchanged, release the lease, then start the normal runtime. Record build duration and any capacity failure without lowering the doctor limit or splicing failed attempts into success.

The final manifest must identify exact source, real test counts, actual mode, model/ASR availability, both stop/restart results, retained data and released owned ports. Screenshots stay internal evidence unless the coordinator explicitly packages them; container localhost is not a user-accessible link.
