# #5193 preview readiness

Web exact source `b4bc0aba7663113c9c585064f7f6b8e5e9cdce73`; reused API source `814dc05a36e1f2645b7528b9dacc0a344ec615ae` (see api-version-compatibility.md). This is not a whole-application exact-b4bc deployment.

- URL http://127.0.0.1:25706, listener PID39881; verified cwd `/Users/shenyangjun/.codex/worktrees/survey-report-echarts/apps/web`.
- API24704 PID4234 retained; original Web25704 PID4946, #5192 API24705 PID14371 and Web25705 PID15611 retained. No infra/provider restart, seed/reset/restore.
- Dist `.next-survey-template-5193-b4bc0aba-20261004`; 124/124 pages, Ready207ms. New/old Web and API /healthz HTTP200. First probe /health returned404 because correct endpoint is /healthz.
- Private same-account login fixture `/private/tmp/survey-all-buttons-20261004/template-login-fixture.json` (600).
- Source combined manifest SHA256 before/after `1bda6d204674ccc34488c314d12b28fc4b41486fc3c92b4e2cff014fb321cfd3`, changed paths none. Removed only Next-generated customdist include; next-env unchanged.
- Counts before/after 2workspaces /4templates /0attachments /0uploadsessions.
- Private full backup `/private/tmp/survey-all-buttons-20261004/before-template-5193-full.dump` (600), SHA256 `9685c353df4a2e86322e375fc440a7e14ec1a92f5a5ce9109d27e0cd14a2be55`.
- Private survey backup `/private/tmp/survey-all-buttons-20261004/before-template-5193-surveys.sql` (600), SHA256 `5fd12846fe5130da80ff23c98b49b17565c7797e6caa5a4f692327356c23b185`.
- Full dump omits cluster roles; recovery requires repository initialization roles and compatible ACL handling. No restore performed.
- Build log `preview-build.log`; private launcher/config `template-runtime.ts` / `template-runtime-config.json`. Existing model/provider config unchanged; no real-model-success claim from readiness.

Actual browser acceptance remains parent-owned.
