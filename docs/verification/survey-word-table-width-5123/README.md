# Survey Word table width — issue #5123

Product SHA: `a5aeb1bc47ccf4bf345d2a8508dd9690a5cdbf1d`. Real UI runtime used this exact clean source. This independent branch does not include the other unmerged survey fixes.

On 2026-10-03 00:04:38 Asia/Shanghai, the browser regenerated owned survey e448d53d-c7b7-44db-a5b7-d6c4f2cc4f5b from 11 genuinely submitted responses, then clicked **导出 Word**. Actual downloaded file `PR5017 报告文件往返验收 (1).docx` is 133501 bytes, SHA256 `498af6c75cb5250e9093df6f99769cd824a16d19c1bb80f3fe5e71fc08c92d69`. Browser download events are unavailable in IAB; the actual saved file, UI timestamp, title and sample values establish the download.

Unmodified downloaded bytes were rendered with the bundled document renderer and local fontconfig pointing to existing macOS Chinese fonts. No source document was patched, no fonts installed. All three fixed pages were visually inspected: Chinese, prose, charts, image/caption, margins and both data tables are legible. The three-column table contains 3.09 / 11; gap rows contain 3.09 / 11 / 5 / 1.91 and 3.27 / 11 / 5 / 1.73, matching UI. OOXML inspection records two fixed DXA tables, total body width 9638, coherent cell/grid widths, five media files.

The before-page-2 screenshot uses the same corrected CJK font environment and shows the original unreadable narrow table. Earlier missing-CJK renderer output was an environment issue and is excluded as defect proof. The original report used 8 responses; the fixed report uses 11, so numerical differences are expected.

Validation: regression RED 1 failed / 10 passed on original product (auto width != DXA); three report UI test files GREEN 20 passed; independent reviewer ran 20 tests plus nonincremental web typecheck and accepted product SHA. Clean production build generated 124 pages, API and web health passed. `init.sh --quick` passed; this is a quick baseline, not full-suite proof. Final PR CI remains required; no merge is authorized.

PDF export invokes browser native printing. These Word-render images do not constitute evidence for the PDF button. QR excluded. No permanent test-data deletion.

## Evidence hashes

- `before-page-2.png`: `a325949a508fe4031d40ab77adf56b7b8806bb3202d1fd9c7fafc85b6c38efe0`
- `fix5123-report-eleven.jpg`: `de3b881bf7636eed7892d895c3179be9bb17518d19e9ec478772845e9334492e`
- `fix5123-report-eleven.txt`: `b16844e3f7f13266146d85b01a50fdc7ef0fe768acdf1f46ec78aa5b322b7b43`
- `fix5123-word-inspection.json`: `130b949b2b67a9fe554cfe3ac09047ae6418b09f3f70f7b23b50bdf27c28278f`
- `fixed-page-1.png`: `187647a183eb8d496c57e6323cdbf3d87bb34372042d342220a293abc0eccfd7`
- `fixed-page-2.png`: `9035adce064191f2adc1df4ed0f73818867dba2e461bf4e1f38409ac21e65797`
- `fixed-page-3.png`: `9d5bdd6b2abc71220ca844a7ef8edfa2f46fd959def7113b6adc001a2c8f2cbd`
