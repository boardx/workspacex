# Research document evidence implementation plan

## Approved behavior

User request: aim for three relevant references per enabled top-level outline section; fewer references may still produce a report. Before writing, retrieve actual documents at the reference URLs. Search snippets must not impersonate document text.

## Current findings

- `guided-runtime-service.ts` counts a search task successful when any relevant result is found; there is no per-chapter reference target.
- `guided-report-evidence.ts` currently chunks `source.content`, explicitly classified as `search_excerpt`.
- `standard-web-service.ts` can extract HTML/text using a guarded fetcher; it refuses redirects and does not support PDF.
- `AnydocAttachmentToMarkdown` already converts PDF bytes. Reuse its port instead of importing a second native parser.
- Report checkpoints hash search content; document content and retrieval version must participate in the basis before checkpoint reuse.

## Implementation steps

- [ ] Add a server-owned optional document result to the source contract for legacy compatibility: successful retrieval contains URL, timestamp, extracted text, content hash, extractor and truncation; failure contains a closed error code and timestamp. Keep discovery content unchanged.
- [ ] Add a document-reader application port and infrastructure adapter. Reuse guarded HTTPS fetching and existing HTML/PDF extraction. Bound response size, operation duration and concurrency. Do not follow redirects without validating each destination; refusal remains an explicit failure.
- [ ] Add bounded supplemental search for enabled sections with fewer than three accepted unique URLs. Reuse relevance screening for each section association. Persist attempted supplementary queries; do not retry indefinitely on refresh. Excluded sources stay excluded.
- [ ] Before report generation, retrieve accepted documents and persist each outcome. A source with no fetched text must not enter report evidence. If every document is unreadable, return a specific actionable error rather than writing unsupported content.
- [ ] Run evidence extraction against actual retrieved text and validate exact quotes. Update content-kind labels and checkpoint basis. Pass per-chapter counts, reading failures and evidence gaps to chapter generation; three references remains a target, not a hard gate.
- [ ] Keep source-list UI simple; show a compact per-chapter reference summary and readable retrieval status where needed. Preserve original source links and Chinese presentation metadata.

## Verification cases

- One source triggers limited supplementation; three unique related sources stop supplementation.
- Duplicate fragments and unrelated results do not fill the target; user exclusions are preserved.
- An exhausted chapter with one readable reference still writes an honest report.
- A fetched document contradicting its search snippet supplies the actual report evidence; fabricated quotes are rejected.
- Mixed readable/unreadable sources retain successful evidence and disclose gaps; all failures prevent unsupported report generation.
- HTML and PDF extraction, empty/oversized documents, private destinations and redirects have explicit bounded outcomes.
- Updating fetched text invalidates stale chapter checkpoints; unchanged documents may resume approved chapters.
- Existing research recovery, source screening, report evidence, checkpoint, UI and fullstack scenarios remain passing.

## Delivery

Issue: https://github.com/boardx/workspacex/issues/3824
Branch: codex/research-document-evidence
After focused verification, create one PR with Refs #3824; attach it to the task and follow CI/review to green.

## Execution status

Environment initialization passed (`ELECTRON_SKIP_BINARY_DOWNLOAD=1 ./init.sh`, quick path). No business source changes yet. Coordination bootstrap is blocked: `pnpm harness tick` reports missing `COORD_GATEWAY_URL`; registered identity and credential path have not been supplied. The bootstrap instruction requires obtaining them before proceeding; user clarification is pending.
