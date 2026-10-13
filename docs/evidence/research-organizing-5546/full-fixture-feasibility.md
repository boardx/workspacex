# Original full fixture feasibility — offline follow-up

Production candidate stays frozen at `78e54395580866abff6b1c32de66434d50ed26dc`. This follow-up changes tests and evidence only. User acceptance is still incomplete: no verified pair of formal first/regenerated reports, no PR, no deployment.

## Important counterevidence

The original captured runtime has 23 accepted sources, four succeeded tasks, four rich chapters with 32 distinct questions, and `reportPartial=false`. Its `planRevision` property is absent, not zero. Source policy, checkpoint instruction, model configuration, and private ledger are absent from the public capture; their absence does not establish absence in private server persistence. Public question/claim evidence arrays are empty.

Pure offline calculation against the captured original text verifies **23/23 source relevance bases match current validator policy 4**, and **22/22 document hashes match**. Therefore the original unchanged route skips source relevance screening: **zero screening model calls**. The seven-source local replay omitted original task title/objective and approval bases and incurred fresh screening, reducing to three sources. Its quality failure is not evidence of the original full route failing equivalently; neither is it a full-route success.

The source-screen rejection branch is an independently reproduced defensive case. The original report-evidence route remains the primary incident hypothesis. The exact historical failed request is unavailable, so batch 15 is a controlled suspicion, not proven supplier attribution to a particular source.

## Available metadata and export blocker

`original-geometry.json` preserves source IDs, original document lengths and hashes, task associations, planRevision absence, aggregate hashes and a **code-derived** 96-chunk/23-batch map. Total original fetched text is 510,413 JavaScript characters. Seattle has only an 88-character search excerpt (SHA-256 `190c8c168fccc7c92d2a0c40f44df715be73e070ae434a623d41350cf4f7e4d0`) and is omitted by canonical fetched-document mode, leaving 22 report evidence sources.

The original complete body remains in the supported browser tool's capture memory. The formal `pageAssets` inventory observed runtime JSON as asset kind `other` (asset `26d10a65680cef99`, inventory `15f08130-0a64-48d2-8e03-088bc28fac78`). Its formal bundle operation rejected it: `Asset bundle request included unsupported asset kinds`. Bundling supports font/image/stylesheet/video, not runtime JSON. Advertised content exports cover Google Workspace and YouTube, not this application. Direct runtime navigation previously produced client `ERR_BLOCKED_BY_CLIENT`, not a server authentication result. No alternative API, arbitrary page JavaScript, clipboard/native app, or other interface is used to bridge the body or bypass that limitation.

`local-document-availability.json` compares the seven existing local reread documents without new retrieval: **five match** original hashes, **two differ** (BBC and newslqy), and **17 of 22 exact original documents are unavailable locally**. Fifteen have no local reread; two only have changed versions. The raw local documents remain outside Git. Rereading/rebuilding them would produce a new fixture, not recover the original. The archived first full local runtime was overwritten as separately documented; its exact draft/history survives in final regeneration history, not as an independent full snapshot.

A valid future full fixture requires an authorized **formal runtime JSON export/file save** or a server-owned authenticated diagnostic/export path preserving the same original persisted document bytes. That capability is not currently available here; main session decides the next acceptance entry. No new read or model dispatch was performed in this follow-up.

## Minimal fields to preserve before a real full replay

- Exact original `brief`, entire enabled outline in original property/order form, including title/objective/analysisApproach/expectedOutput/subsections/questions, and original tasks with id/sectionId/questionId/query/title/objective/deliverables. Preserve absent optional fields as absent, including planRevision; do not manufacture values.
- Every source's id/taskId/taskIds/title/url/content/decision/addedByUser/relevanceBasis and complete document url/text/contentHash/contentKind/truncated/retrievedAt/summary. Preserve original bytes, not reread summaries. Original presentation may also be preserved for rendering.
- Existing source policy, instruction/checkpoint, report history, evidence rejection warnings, private ledger, model configuration identity and persistence version/revision where actually available. Public absence must be distinguished from unavailable private state. Do not copy a prior adapter's lifetime identity into a new provider.
- Check all original relevance bases and document hashes before dispatch. Do not attach an original approval/hash to synthetic replacement text. A fixture with substituted text is only a mechanics test.

## Controlled offline regressions

`full-source-geometry-fixture.ts` creates explicitly synthetic, chunk-specific text with the original 23-source lengths/task association geometry; all document hashes and approvals are calculated from that synthetic text. It uses four controlled rich chapters and 32 questions, never claims original semantic approval or report quality.

1. Unchanged approvals retain all 23 sources, `reportPartial=false`, absent planRevision and **zero screening calls**. Changing one source title triggers exactly one screening call, demonstrating legitimate invalidation.
2. Report extraction dispatches all 23 batches. Exact owned rejection of batch 15 excludes its five chunks across three sources without mutating the 23 source admissions. The long source's other **eight chunks (2–9)** still produce verified ledger records. On the identical second extraction, the refused request is skipped and 22 healthy batches execute. This proves chunk exclusion does not silently become whole-source removal.

Both regressions pass; complete research unit suite **32 files / 717 tests** passes. API typecheck and complete API lint pass. These are extraction/screening mechanics checks, not formal-report or deployment acceptance. Existing attempt/quality/citation gates are unchanged.

## Static model-call upper bound — not executed

Boundary: logical audited requests and outer `ModelCallPort` dispatches in `guided-report-chapters.ts`. Hidden adapter/provider internal HTTP routing or retries are not counted; original historical provider configuration is unknown. Conditions: four fresh chapters, no usable report checkpoint, unchanged original approval basis, no cancellation/failure short-circuit, at most existing repair bounds.

| Stage | Existing bound | Logical calls per generation |
|---|---|---:|
| Source screening | 23 matching approvals | 0 |
| Evidence extraction | 23 batches × 2 initial/quote repair attempts | 46 |
| Chapter writing | 4 chapters × 2 write/revision attempts | 8 |
| Initial review and partial-coverage proof | 4 chapters × 2 writing attempts × (2 initial review format attempts + 2 partial-proof format attempts) | 32 |
| Existing independent gap verdict | At most one attempted dispatch per chapter | 4 |
| Synthesis | 2 attempts | 2 |
| **Total** | Conservative branch upper bound | **92** |

`makeAudit` permits at most two outer dispatch attempts for recoverable transport failure: **184 ModelCallPort calls per generation / 368 for both** is a conservative ceiling. Exact content-policy refusal is not recoverable and is never retried as transport. These maxima need not be jointly reachable and do not predict duration or guarantee a formal result. A clean pass with no proof/repair/transport retry is 23 evidence + 4 write + 4 review + 1 synthesis = **32** first-generation calls; one identically cached refused batch can reduce subsequent evidence dispatch to 22 (31 total), conditional on unchanged actual request and adapter identity. No new product or test budget is authorized; current real-dispatch allowance is zero until main session decides.

## Hash algorithm vectors

Offline SHA-256 implementation used for original capture verification was checked against standard Python hashlib: UTF-8 `abc` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; UTF-8 `中文😀` → `e973a1c1b41c5c9f4fbac31fcc311536dfffd003bfb914580455170a599953fa`. Source/outline/task/brief hashes are over JavaScript JSON.stringify order, not reserialized Python JSON. Aggregate hashes identify original capture metadata, not the synthetic fixture.
