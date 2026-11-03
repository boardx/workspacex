# Complete research UI internationalization — #6198

Branch: `worker/i18n-research-entry-6198`. Base: develop `44aeac6e10b688471fe03536fc8490a353824976`. All commands ran in the original checkout, serially with the other workers. No additional worktree.

The committed `.txt` receipts normalize ANSI formatting and record observed process exits. Failed-run receipts retain the relevant failures and summaries; `validation.json` records the SHA-256 and local path of each original full log. Full local logs are not substituted for a green result.

| Check | Observed result |
|---|---|
| Standard `./init.sh` | exit0, quick path; full repository verification was not requested by this command |
| `pnpm --filter web typecheck` | final exit0; first run caught invalid Testing Library options, which were corrected |
| ESLint of all changed/new web TS/TSX files, `--max-warnings 0` | final exit0 |
| Three new i18n suites and seven affected regression suites, one worker | 10 files,112 passed,18.89s |
| Earlier broad related regression, one worker | 67 files,627 executed,626 passed/1 obsolete Contents assertion; corrected focused reruns are separate receipts |
| `pnpm run lint:vitest-config-reachability` | exit0;69 configs,12 live specs reachable |
| Isolated Playwright discovery | exit0;exactly1 test in1 file;2s total,cleanup0s |

Discovery command (actual execution must use identical arguments with only `--list` removed):

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded e2e/i18n-research-entry.spec.ts --workers=1 --max-failures=1 --list
```

The browser has not run yet. It uses standard real login/API/PostgreSQL with the existing deterministic model fixture. The standard lane verifies localized saved-file entry points; actual native Skill conversion bytes retain their existing native lane. ASR tests use controlled stream events and do not claim external-provider acceptance.

Canonical report bytes, source framing and exported Markdown stay in their original language. UI contents controls, actions, errors, status and history labels follow the locale. User-visible shortcut examples prefill localized editable drafts; internal command prompts remain unchanged. New editable plan/chapter titles are localized only when created. Existing content and user edits are not retranslated.
