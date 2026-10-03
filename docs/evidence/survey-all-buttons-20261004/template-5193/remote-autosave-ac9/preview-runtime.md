# #5193 ac9 preview readiness

Web exact source `ac9fa46fbe54d41f6aa5be03c8ba707e152d3f2a` (product bytes equal independently checked 9df). API reused source `814dc05a36e1f2645b7528b9dacc0a344ec615ae`, survey/backend relevant paths compatible as recorded in ../api-version-compatibility.md. Whole application is not exact ac9.

- URL http://127.0.0.1:25707; listener PID52447; unique dist `.next-survey-template-5193-ac9fa46f-20261004`. 124/124 pages, Ready213ms, HTTP200.
- API24704 /healthz200; old Web25704/25705/25706 all HTTP200, retained. No stop/restart infra/providers, seed/reset/restore.
- Private same-account fixture `/private/tmp/survey-all-buttons-20261004/template-ac9-login-fixture.json` (600).
- Source manifest SHA256 before/after `9fc1332f5a48bcd5cf48d07925c583703f06a0d42e60b724176fac18169a0048`, zero differing paths after removing only auto-generated customdist include; next-env unchanged.
- Survey counts before/after 2workspaces/4templates/0attachments/0uploadsessions.
- Private full backup `/private/tmp/survey-all-buttons-20261004/before-template-ac9-full.dump` (600), SHA256 `e97124222dc8c79bdc43196e6a63b07498ef65e862df554a1c4127b2840b91ad`.
- Private survey dump `/private/tmp/survey-all-buttons-20261004/before-template-ac9-surveys.sql` (600), SHA256 `574c4420d9a7d64ec626992c7aaf876dc7a69edbd76f4bb8096df62718a17e5b`.
- Cluster roles are omitted from full dump; recovery needs repository initialization roles/compatible ACLs. No restore performed.
- Existing unknown dirty pnpm-lock.yaml/pnpm-workspace.yaml protected unchanged; no approve-builds. They are outside product manifest; source equivalence does not assert package-file cleanliness.
- Actual browser acceptance for ac9 remains parent-owned; prior b4bc UI evidence belongs only to b4bc. Configured real-model lane unchanged; readiness does not prove real-model success.
