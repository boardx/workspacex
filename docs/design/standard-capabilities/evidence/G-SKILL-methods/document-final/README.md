# S018 actual dual-document model acceptance

Command: `source scripts/real-model-env.sh; real_model_load_env_file /Users/shenyanbin/Documents/workspacex; WX_AUDIO_REAL_EVIDENCE=/private/tmp/wx-s018-gate-final WX_NATIVE_SANDBOX_CONTAINER=wx-document-real-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run --config vitest.document-skill-real-model.config.ts`.

2026-09-07: wrapper 29355 exited 0, 1/1 passed, 68 seconds including cleanup, peak 2 DB connections. Real qwen3.8-max selected the complete pinned Skill and called both document parsers. Original prompt retained; no prompt-level serialization workaround. Previous parallel 409 evidence remains in `../remaining-first/S018`.

Manual content review compared report.md and final response to actual PDF table structures and OCR word boxes/confidences. Four values 120/230/340/450 are correctly located on pages 1/2 and sum to 1140. Unknown Region glyphs and currency are not guessed. Cross-page grouping is explicitly heuristic, not established semantic continuity. OCR amount 75 and currency-not-stated match the actual raster image opened visually; reported rounded confidence and pixel box match Tesseract output. Both source SHA256 values match originals. Zero tools on the unrelated arithmetic negative. Real staged artifact was written back through existing application code (result.json actualWriteback=true).

This is the bounded synthetic cross-page table plus single scanned image acceptance, not an OCR accuracy benchmark or a guarantee for arbitrary documents. Current source revocation and restored cached-file access are separately verified by the native input binding tests; not falsely attributed to this model case.
