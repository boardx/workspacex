# W08 bounded offline OCR

## Verified scope

Explicit `ocr:true` adds PDF/PNG/JPEG recognition using installed Tesseract 5.3.0-2 and English/Simplified Chinese data 1:4.1.0-2. Default AnyDoc text extraction remains unchanged. The adapter invokes official Poppler/Tesseract CLIs, not an alternate recognition framework. It uses the original current-authorized immutable `/inputs` bytes, existing sandbox timeout/process cancellation, no network, 1 GiB and 128 PIDs.

`structurePath` and `structureHash` occur together or not at all in a strict object union, including generated Python JSON schema. Structure contains actual PDF page index (or image page 1), rendered page pixel size, Tesseract word boxes and engine confidence. Pixel boxes are not PDF point coordinates; confidence is not a guarantee of factual correctness. Cross-page table reconstruction and native Office cell/slide structure remain unimplemented.

Shared limits: 10 pages, 2048 maximum dimension, 4194304 pixels/page, shared sandbox 8 MiB combined Markdown/JSON output, existing 30-second execution. Pages process sequentially. Child stdout/stderr are file-backed and bounded with RLIMIT_FSIZE; overall process-group execution retains existing cancellation. Over-limit/invalid/empty/malformed results fail, never silently truncate or replay. Partial unreferenced workspace files may remain after failure; no attachment/event is published by parse.

## Results

- Preimplementation explicit-OCR contract red saved.
- Contracts 4/4 and Python 6/6, including half-pair structure reference rejection in both languages.
- API/library 6/6 plus native fullchain 1/1. Fullchain additionally uploads a real raster PNG, executes real authorized HTTP OCR, reads actual JSON bytes and verifies hash/page/text; default AnyDoc/factory/artifact path still passes.
- Real sandbox raster PNG/JPEG and two-page PDF **without a text layer** recognized Chinese and English/numbers. Actual bbox/confidence and original byte equality checked; one-page budget rejects two-page PDF.
- S018 1.1.0 full three-file package loader passes; committed 1.0.0 embedded package remains untouched. No real external model G-SKILL claim.
- Final API typecheck has no document error but reports concurrent `mcp-execution-descriptor.ts:8` possible undefined inputSchema. This is recorded, not claimed green.

## Reproduction

```sh
pnpm exec tsx packages/contracts/scripts/generate-standard-document-schema.ts --check
pnpm --filter @repo/contracts exec vitest run tests/standard-document-tools.test.ts
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_document_tools.py -q
pnpm exec tsx skills/standard-document/scripts/build.ts --check
pnpm exec tsx skills/standard-document/scripts/verify.ts
docker build -t workspacex-skill-sandbox:w08-ocr apps/skill-sandbox
docker compose -p wx-doc-ocr -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w08-ocr-override.yml up -d
docker exec -i wx-doc-ocr-skill-sandbox-sessions-1 node --input-type=module < apps/skill-sandbox/tests/document-ocr-container.mjs
WX_NATIVE_SANDBOX_CONTAINER=wx-doc-ocr-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-document-tools.test.ts tests/chat/anydoc-attachment-to-markdown.test.ts; pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'
docker compose -p wx-doc-ocr -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w08-ocr-override.yml down --volumes
```

Override only selects `workspacex-skill-sandbox:w08-ocr`; no policy/resource changes. All owned DB/container/volumes cleaned after verification. Fixture PNG is generated text on white using the existing CJK font; no personal content.

## Source and licensing

- Engine [Debian fixed package](https://packages.debian.org/bookworm/tesseract-ocr), [official Apache-2.0 documentation](https://tesseract-ocr.github.io/tessdoc/Installation.html).
- [Official TSV output](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) supplies words, boxes and confidence.
- [Debian Chinese model](https://packages.debian.org/bookworm/tesseract-ocr-chi-sim), [English model](https://packages.debian.org/bookworm/tesseract-ocr-eng). Installed copyright/version/model SHA256 are saved in provenance log; the container retains distribution copyright files. No runtime model download.
- [Existing Poppler page rasterization](https://manpages.debian.org/bookworm/poppler-utils/pdftoppm.1.en.html); no additional PDF engine or new isolation mount.

## Changed files

- `packages/contracts/src/standard-document-tools.ts`, generator and contract test; generated Python schema.
- API `standard-document-service.ts`, document tests and native fullchain fixture/test.
- Python document tool description and tests.
- Sandbox Dockerfile, `scripts/ocr-document.py`, `tests/document-ocr-container.mjs`.
- S018 source/build/verify and new `skills/starter-packs/standard-document/1.1.0.json`.
- This evidence; root owns seed selection, kernel/factory and commits.
