# Chat public sharing — issue #5655

User-requested ad-hoc delivery: publish a reviewed, whole-conversation snapshot and let friends open it on mobile or desktop without an account.

## Behavior and boundary

- The creator opens Share in the current Chat header, previews the server snapshot, then explicitly creates a link.
- Only the creator with current read access may publish/manage it; observers and personal-local organizations cannot publish.
- Creation re-reads the authoritative conversation and requires the preview revision to match. New or changed content requires a new preview.
- The public page reads an immutable snapshot, without account membership or a bearer session. It includes conversation text, Markdown/code and copied raster image attachments. Other attachments show names only.
- Raw transcripts, pending-review messages, internal tool/run ledgers, author IDs and storage keys are not published.
- A random 256-bit capability is returned once. Only its SHA256 hash is persisted. The anonymous directory contains routing hints and hashes, no content.
- Snapshot rows have forced tenant RLS. Public access uses the matching active snapshot; source deletion and organization disablement stop access.
- Revocation stops subsequent requests. An already received copy cannot be withdrawn.
- Public reads use no-store and noindex. Request diagnostics redact capability paths.
- Clipboard results are scoped to the current link/request. A delayed old copy cannot claim that a replacement link was copied.

## Verification

The recorded outputs are in api-unit.txt (13), api-http.txt (5), ui-unit.txt (8). The separate existing observer regression passed 12 cases. Browser rendering and the real login → publish → clipboard → new anonymous phone/desktop → revoke flow passed 4 cases, 0 skipped; the latest clipboard/path client was additionally rechecked against the real server. The included screenshots use an actual 180px raster attachment.

API, Web and contracts typechecks passed. API lint, Web ESLint/design lint, contract-source and rewrite-coverage gates passed. Standard ./init.sh quick bootstrap passed. Production deployment has not been performed.

## Reproduction

1. Install with ./init.sh.
2. Run API unit cases:
   pnpm --filter @repo/api exec vitest run --config vitest.chat-share-unit.config.ts
3. Run HTTP cases in the repository isolation wrapper:
   pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/chat/share-chat-http.test.ts --maxWorkers=1 --minWorkers=1
4. Run UI cases:
   pnpm --filter web exec vitest run tests/ui/chat-public-share.test.tsx
5. For the real browser lane, start isolated postgres+redis, set MODEL_CREDENTIAL_KEY and WORKSPACEX_OBJECT_ROOT to test-only values and run apps/api/tests/chat/share-chat-browser-server.ts in the same isolation environment. Start Web with NEXT_PUBLIC_API_URL pointing to Web, FULLSTACK_E2E_API_ORIGIN/API_INTERNAL_URL pointing to API and NEXT_PUBLIC_API_PATH_PREFIX=/__fullstack_api. Set E2E_BASE_URL and CHAT_SHARE_REAL_E2E=1, CHAT_SHARE_E2E_PASSWORD=ShareBrowser5655! and run:
   pnpm --filter web exec playwright test --config playwright.chat-public-share.config.ts
   The password belongs only to the disposable fixture account, not production.

## Assembly file size

kernel.module.ts was already over 2000 lines. This delivery adds only controller/provider registration; all new application logic and provider factories live in separate files. Temporary assembly-only exception for these registration lines, owner codex/chat-public-share; remove it when kernel composition is split into domain modules. No business logic was added to that large file.

## Independent review

The UI verifier did not author the production code and separately reviewed permission, snapshot, token and async behavior. It found a P2 delayed clipboard result race. A failing regression was demonstrated before the fix; both old-copy-before/new-copy-after completion orders now pass. No remaining blocking findings were reported. This is an independent agent audit, not a GitHub formal approval.
