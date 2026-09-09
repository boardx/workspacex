# Final main deployment confirmed at23:05Z

[Deployment attempt2](https://github.com/boardx/workspacex/actions/runs/34413017866/attempts/2) succeeded for `8e08a8f98ce5e9b3c3d57c6d888d85726744fab2`. [Fresh server observation](./final-main-service-check.txt) confirms this checkout, API/Web active since07:03:28CST, running Agent image8e08a8f9 and healthy RLS/trust assertions. HTTPS login returned200. The final main tree equals the reviewed PR and tested synthetic merge trees.

Attempt1 failed at native environment sampling about52ms after active. The identical root-owned assertion and native callback assertion passed on the stable process. Attempt2 succeeded without relaxed checks. Follow-up#3294 records the startup sampling risk. Authenticated human acceptance remains pending because the Mac is locked.

All observations below are historical and superseded by this final main deployment.

# Devapp deployment observations — historical success, current candidate displaced

**Latest observation (2026-09-09T22:14Z): the shared devapp checkout is main `f95a1fadf7eb2046ad8e9a6f1bf99a5c49a70f7a`, not the complete frozen candidate. API/Web were active with start time 06:11:42 CST (22:11:42Z).** The recovery deployment attempt 2 had succeeded, but a later main deployment replaced it again. Neither successful attempt establishes that the full candidate is currently stable on devapp. This update records the coordinator's latest read-only SSH observation; the earlier attached snapshot below remains a historical receipt.

The final integration route is PR #3272 (pushed head `ab859a6976ce4e421068fd3a04bf7aa84523fcd8`, awaiting exact-head CI and main merge). PR #3273 merged at 22:07:41Z into the API integration branch (`2cf975…`), not directly into main. Administrator login remains blocked, so authenticated devapp acceptance has not run. Recheck actual deployed identity after final integration and at the end of acceptance.

## First successful deployment and historical snapshot

Candidate: `c3e1cb929e33ed45db8d84ce14ba133683de0c2d`. [Deployment run](https://github.com/boardx/workspacex/actions/runs/34404778064/attempts/1) succeeded after all existing gates. The exact-SHA checkout guard succeeded even though the branch subsequently acquired an E2E-only proxy correction. Deployment log reports completion at 2026-09-09T21:46:21Z and stable readiness through 21:46:24Z.

The attached read-only VM snapshot was collected at 21:53:04Z. Checkout SHA matches; API/Web are active with restart time 05:46:07 CST; the native Agent image is `deep-agent-service:c3e1cb92` and running. Health reports trustworthy=true, rlsForced=true, appRoleIsOwner=false. A separate unauthenticated HTTPS probe to https://devapp.boardx.us/login returned HTTP200. No credentials are included.

This establishes a deployment and service-health observation, not an authenticated human-browser acceptance or an immutable API-process SHA attestation. The Mac remained locked and administrator login was pending. Git HEAD alone would be insufficient; this receipt correlates the successful deployment, restart timestamps, image identity and health. A later main deployment has now actually replaced the candidate; this is an observed displacement, not only a hypothetical risk. Recheck actual deployment before final handoff.

See the separate fullstack evidence for 79 passing browser cases (one existing inbox fixme) and the real-model evidence for local provider/native-chat execution. Neither is relabeled as a devapp authenticated run.
