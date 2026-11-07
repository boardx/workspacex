# Recording threshold-marker limited review

Exact BASE f998aadc66a08090302533ed629afdf9a039a47f -> HEAD 89745fd03525e4422b8d6c638b018488eacaddc0

STATIC CLEAN: no actionable P1/P2. Exactly two files each change one line. Accepted ec169 marker/reason and original 180-day Chinese literal are preserved byte-for-byte; marker/reason occurs once across the changed source pair, beside the actual canonical literal. Original JSX separator is retained explicitly.

TypeScript transpileModule with removeComments=true yields byte-identical before/after output for both files (ES2020/ESNext/react-jsx); neither compiled output was executed.

```json
{
  "changedFiles": [
    "apps/web/components/rec/retention-panel.tsx",
    "apps/web/lib/recording-display-copy.ts"
  ],
  "originalMarkerAndReasonMatch": true,
  "markerOccurrencesInChangedPair": 1,
  "originalLiteralExact": true,
  "transpile": [
    {
      "file": "apps/web/components/rec/retention-panel.tsx",
      "equal": true,
      "sha256": "c8b6553e2f44c899a994384b7763c9002eda3e0f29e2dcdc9edc71f546c144f5"
    },
    {
      "file": "apps/web/lib/recording-display-copy.ts",
      "equal": true,
      "sha256": "b0923e23b7b8d62121d422cdb2f4132aa13360c1aff40853f46e7d2e368c54bf"
    }
  ]
}
```

No tests/typecheck/init/browser/push/services or source edits performed. Prior source/browser/evidence reviews inherited, not repeated. This is a marker relocation check, not fresh runtime/CI acceptance.
