# W08 text-document increment

`wx_document_parse` accepts `workspacePath` only when it exactly matches the current
run's fixed original-input manifest. The name is retained from T019; this increment
does not accept arbitrary mutable workspace files. `outputMode` accepts only markdown
and `ocr` only false. Unsupported modes fail before dispatch rather than being ignored.

The existing native owner resolves the binding; NativeRunInputs reuses current source
visibility and checks original ObjectStore bytes. A bound UDS read verifies actual mounted
bytes against the fixed manifest. The service checks actual ToolExecutionAuthority before
reading and again immediately before dispatch. Default L2 approval remains in force.

The sandbox executes the existing @firecrawl/anydoc 0.1.8 official CLI with fixed, individually
quoted arguments. The exact dependency already existed in the API and is now installed at
image build time in the sandbox too. It uses no remote service or runtime installer. The
ordinary session execution timeout kills/reaps the process; unknown results are not retried.
Unique output directories avoid overwriting user files. Result text is read back as strict
UTF8 and hashed; current source permission is checked again before returning a path.

The result contains textPath, original sourceHash, textHash and source metadata. Fixed
warnings disclose missing OCR/page coordinates and possible table-layout loss. Output is
a workspace file, not a ready attachment. The existing artifact publication path remains
the only delivery mechanism. Failed parsing may leave an unreferenced workspace directory
or partial file; it never returns a successful result or creates an attachment/event.

This does not replace the upload extraction outbox or claim its digest-less cached Markdown
matches a current fixed original. It parses verified originals with the same mature engine,
without a second queue, document parser implementation or artifact registry.

Remaining full W08 requirements: structured chunks with defensible source locations,
cross-page table evidence, maintained offline OCR with scan-quality warnings, password
fixtures, and real-model S018 G-SKILL. The packaged document-understanding method explicitly
documents this increment's limits. Its file/hash validation alone is not G-SKILL.

Provenance: the locally installed package identifies @firecrawl/anydoc 0.1.8, MIT;
pnpm-lock.yaml integrity is
`sha512-DJXcCdEL1CcIyRRO/2C6SAcvn/SgM0nnpeGLOyZxJwCZJlx9s0HBUnsNtvQd5UHFUY/vZOURMOUf/h4I3HLjvQ==`.
Official implementation: https://github.com/firecrawl/anydoc/tree/main/node
The installed CLI documents stdin/file conversion, format selection, Markdown output and
unsupported image-only PDFs. No Docling deployment is claimed by using its future design
reference: https://github.com/docling-project/docling/blob/main/docling/.agents/skills/docling/SKILL.md

## Subsequent bounded OCR increment

Explicit `ocr:true` now uses fixed offline Tesseract plus existing Poppler for PDF/PNG/JPEG. It returns verified Markdown plus a paired structurePath/structureHash with real page pixel coordinates and word confidence. Default AnyDoc remains text-only. Full bounds, licensing, actual scan/HTTP evidence and remaining cross-page/native-Office structure gaps are recorded in [OCR evidence](evidence/W08/ocr/README.md). S018 1.1.0 is a new complete package; 1.0.0 remains immutable.
