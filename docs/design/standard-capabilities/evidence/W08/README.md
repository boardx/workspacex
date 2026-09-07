# W08 AnyDoc text extraction increment

This evidence covers real native input file → approved document tool → offline AnyDoc CLI → verified Markdown. It does not close all W08 or claim S018 G-SKILL completion.

## Results

- Shared contracts: 2/2; Python tool: 5/5; complete S018 starter package loader and tamper rejection: pass.
- API document failure cases plus existing AnyDoc library regression: 5/5.
- Native full chain: 1/1. Actual application-uploaded DOCX is resolved from the fixed readonly input manifest, parsed inside the real isolated sandbox, and read by the official Python factory. Source/output hashes are checked. PG missing grant, stale lease and forged path are rejected. Existing artifact writeback remains one artifact/one attachment; parsing does not publish its intermediate Markdown.
- Dedicated sandbox: DOCX/XLSX/PPTX/PDF/CSV with Chinese text and simple tables parsed offline; original bytes unchanged. Corrupt DOCX fails and creates no successful output. Limits remain 1 GiB and 128 PIDs. Two-page PDF yields text but no claimed page coordinates.
- API typecheck: no document/fullchain error; blocked by concurrent MCP `pg-mcp-review-snapshots.ts:31` missing `appendWithin` and `listByServer` members, recorded in log rather than marked green.

## Commands

```sh
pnpm --filter @repo/contracts exec vitest run tests/standard-document-tools.test.ts
.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_document_tools.py -q
pnpm exec tsx skills/standard-document/scripts/verify.ts
docker build -t workspacex-skill-sandbox:w08-anydoc apps/skill-sandbox
docker compose -p wx-doc-parse -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w08-anydoc-override.yml up -d
docker exec -i wx-doc-parse-skill-sandbox-sessions-1 node --input-type=module < apps/skill-sandbox/tests/document-parse-container.mjs
WX_NATIVE_SANDBOX_CONTAINER=wx-doc-parse-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-document-tools.test.ts tests/chat/anydoc-attachment-to-markdown.test.ts; pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'
docker compose -p wx-doc-parse -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w08-anydoc-override.yml down --volumes
pnpm --filter @repo/api typecheck
```

The temporary compose override only selects the independent image tag `workspacex-skill-sandbox:w08-anydoc`; it changes no isolation settings. Wrapper automatically released its database; the dedicated sandbox container and volume were removed after the successful run.

## Remaining boundaries

Only Markdown text extraction is implemented. OCR, structured page/slide/cell coordinates, cross-page table reconstruction and confidence are not implemented. Output warnings state these limitations. A failure can leave an unreferenced workspace directory or partial file, but returns no successful file reference and creates no attachment/event. Timeout or unknown dispatch outcome must not automatically replay. Full chain uses a scripted BaseChatModel and actual backend/UDS/PG/storage, not a real external model or browser upload UI.
