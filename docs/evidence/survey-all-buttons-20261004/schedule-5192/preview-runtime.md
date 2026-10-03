# #5192 exact-source independent preview

Source `5eff031f44eeee9e9bd6f5e6ba11ed4d49ef4eaa`, production bytes SHA256 `18f01fab73a98a895f56a09d2e6dc7e95f609d399a1e1c1b9eabdd0382f0588a`. Full tracked Web/API/contracts source manifest and combined hash match before/after build. Only Next-added custom-dist include removed; next-env unchanged. No source/Git/PR action by runtime worker.

New API PID14371 at `http://127.0.0.1:24705/healthz` HTTP200. New Web PID15611 at `http://127.0.0.1:25705/studio/survey` HTTP200, distinct `.next-survey-schedule-5192-5eff031f-20261004`. Clean production build124/124 pages, optimization/traces, Ready162ms (`preview-build.log`). Compiled `/__fullstack_api/surveys/*` and public survey rewrites target new24705 API; invalid public token returns API JSON404 through sameorigin.

Private same-account fixture `/private/tmp/survey-all-buttons-20261004/schedule-login-fixture.json` mode600, updated newpreview URL. Private runtime config `schedule-runtime-config.json`; launcher session85683; private logs `schedule-api.log`/`schedule-web.log`. Existing authorized qwen3.8-max/dashscope model configuration reused unchanged; actual successful model call remains an actual UI acceptance task, not proven by synthetic provider health.

Original latest-main814dc API4234:24704 and Web4946:25704 both retainedHTTP200. Same five provider processes and compose `wsx-12206c10884603680c38` reused; no newstack/providers or reseed. BothAPI instances share owned browserDB `wsx_12206c10884603680c38`20704; underlying records/keys unchanged.

Before startup private mode600 fullDB snapshot `/private/tmp/survey-all-buttons-20261004/before-schedule-5192-full.dump` SHA256 `c4e6cdea0fc00e548e618bbd53a3afc5e2e52f1eebc10011af3324d49d5b20d4`; survey snapshot `before-schedule-5192-surveys.sql` SHA256 `f4b4b946e3ca19bce2a583b72e540701047e4d4ec5f00724882f3afb43d23118`. Counts before/after identical2workspaces/1template/0attachment/0uploadsession (`counts-{before,after}-build.txt`). No restore/reset/answers seed or browser manipulation.

`sanitized-log-tails.txt` supplies earlier unchanged RED/GREEN/gate result tails for later documentation. No tests repeated during startup. Await parent actual browser acceptance; this document does not claim live scheduling/model UX passed. Retain all runtime resources until explicit cleanup authorization.
