# Authenticated PAPER visual evidence

The existing `chat-read` job skips **all pull_request events**, not specifically draft PRs. Marking the PR ready cannot unlock it. Its existing workflow_dispatch `run_e2e_full=true` runs the isolated browser lane without modifying event protection or workflow permissions.

The added case in `chat-task-workbench-empty-state.spec.ts` is already covered by the current project testMatch. It reuses the single canonical login fixture and waits for a successful real Home configuration API GET plus `home-screen`; then navigates to real Chat and requires an enabled composer. The shared capture helper uses the real personal-menu theme control, captures 1024×600 and 375×812 light/dark, and checks horizontal overflow. It writes successful PNGs and non-secret SHA/run/runtime receipts under the existing artifact-upload path `test-results/paper`.

The existing long-thread scroll case retains every original 1848×902 geometry assertion. Only after those pass, the helper captures the actual Chinese thread at matching PAPER viewports/themes and requires overflowing messages to reach their real scroll bottom. No injected mock DOM, cross-origin bearer copying, production account or permission change.

Expected evidence: Home, empty Chat and long Chinese Chat × two viewports × two themes = 12 PNG/JSON pairs. They are expectations until executed; typechecking alone does not confirm rendering.

Runtime: repository with-test-isolation wrapper, fresh isolated database/ports, signed seed-account login, real API/persistence and production UI renderer. Model/ASR upstreams are deterministic loopback providers. This proves UI/auth/API behavior, **not professional quality of real AI output**.

Before dispatch, freeze the pushed branch and compare existing workflow run events/head_sha. A pull_request run cannot satisfy the Chat lane because of its protected condition. If no eligible same-SHA dispatch is already running, issue exactly one existing workflow_dispatch:

```sh
gh workflow run harness-verify.yml --repo boardx/workspacex \
  --ref codex/paper-design-system-20261004 \
  -F fresh_run=true -F run_e2e_full=true \
  -F run_chat_task_workbench=false -F run_chat_path_coverage=false
```

Verify the returned/discovered run's head_sha matches the frozen source. Existing artifact name is `phase-01-chat-read-evidence-{run_id}`. Inspect both step conclusions and actual test counts/screenshots; a job with continue-on-error can display success while its execution failed. Do not infer successful evidence from a green aggregate alone. Download only the screenshot/receipt/log evidence necessary for QA; avoid session traces or credentials.

The existing dispatch enables several test jobs, not a narrow single-Chat runner. Configured upper budgets include Chat 60m, full-regression-core 90m, fullstack-smoke 35m and self-service-profile 20m. These are ceilings, not completion-time promises. It has no production deployment step. No local DB/Docker/heavy build is started. On failure, diagnose the exact source/runtime cause rather than blindly rerun.
