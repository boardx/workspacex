# Existing remote Chat runtime selection

Inspected source: `7e8e779b871ea9d2c4a67ee507188500623936dc`. This is a read-only wiring inspection, not a new Playwright discovery or browser result.

- `.github/workflows/harness-acceptance.yml` is triggered by `merge_group` targeting `develop` and `workflow_dispatch`. It has no `pull_request` trigger. Opening a Draft PR alone therefore does not prove that this workflow ran.
- `chat-test-plan` invokes `.harness/scripts/ci-chat-shards.mjs --verify`. Its discovery uses `playwright.chat-read.config.ts`, project `chat-read`, with no file exclusion or title grep. The two configured partitions must cover every discovered identity exactly once.
- `chat-test-shards` uses the same canonical config/project with `--max-failures=1`, its assigned shard, and JSON reporting. Existing CI worker configuration is unchanged. A first failure can prevent later cases from running; registration is not evidence of completion.
- The canonical `chat-read` project regex explicitly includes `i18n-chat-workspace.spec.ts`. That file declares seven cases: personal sidebar/draft at 1280 and 375; active run/locale/reload; material upload/preview/download; permission dialog; project context; different seeded principal/private-thread denial. Its original per-case timeout is 240000 ms.
- The permission case retains real Dialog, fieldset, card and four decision-button x/y viewport bounds at 1280 and 375. The denial case retains the persistent skill-failure/input non-overlap assertion, disabled send and zero writes. Both are within the registered original file, not a separate unregistered geometry spec.
- The narrow targeted-UI policy only permits its reviewed one-source boundary and at most 17 companion files. This Chat branch changes multiple source files and its config/spec, so it does not meet that boundary and retains the full-regression path.

No workflow, trigger, budget, shard policy or runtime framework was changed. Main must choose the existing exact-source remote execution path; the worker has not dispatched a workflow or entered the merge queue. The latest geometry implementation remains without a fresh native browser verdict and PNG QA. Prior seven-case PASS and two subsequent visual failures remain separate evidence.
