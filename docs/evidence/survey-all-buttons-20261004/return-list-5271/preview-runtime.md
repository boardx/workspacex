# #5271 return navigation preview

Web exact SHA `4c0017fd2cb42102c53b89258162a16e58ea37ab`. Reused API24705 source `5eff031f44eeee9e9bd6f5e6ba11ed4d49ef4eaa`, PID14371: read-only diff of apps/api/src+packages/contracts/src has zero Survey-related paths. API24704 source814 has Survey schedule differences and was not selected. This is not a whole-application exact4c0017 deployment.

- URL http://127.0.0.1:25708/studio/survey; Web listener56810, ownWT/apps/web; 124/124 pages, Ready150ms; Web200/API /healthz200.
- Unique dist `.next-survey-return-5271-4c0017fd-20261004`; all existing services kept, no seeds/reset/restore/new infra.
- Private same-account fixture `/private/tmp/survey-all-buttons-20261004/return-login-fixture.json` (600), no new account. No credentials in evidence.
- Source manifest before/after SHA256 `d740989ee0fd2a35d5081d60ccfcb9155e703f8695bdbb552f47c6979a9159ef`, zero changed paths after removing only auto-generated customdist include; next-env unchanged.
- Before/after counts 3workspaces/4templates/0attachments/0uploadsessions.
- Private full dump `/private/tmp/survey-all-buttons-20261004/before-return-5271-full.dump` (600), SHA256 `9258980f9a4b6eec32149c37a3ae21bb6bda14df7d000e25f83abdbede0fd863`.
- Private survey dump `/private/tmp/survey-all-buttons-20261004/before-return-5271-surveys.sql` (600), SHA256 `d83a4b399971cd8750827c8e8d88f68360a42cd6b4f2332ca552f9a348dd7df3`.
- Dump excludes cluster roles; restoration requires repository initialization roles/ACL handling. No restore performed.
- Unknown dirty pnpm files protected unchanged; package cleanliness not asserted by product manifest. No approve-builds.

Scope: return navigation; actual UI belongs to parent. Existing model/provider config unchanged; no real-model request proof claimed here.
