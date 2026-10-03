# R2 D002 research acceptance — incomplete

Issue: https://github.com/boardx/workspacex/issues/5185 . Source baseline: e4ce1c30cf6f0e4bdf5f15b514cb830d8924f6e3. No deployment was requested or changed. DevApp health exposes migration and RLS status, not a trustworthy running Git SHA; deployed source revision remains unknown.

## Actual DevApp observations

Baseline thread `thr-7b9b2172-d861-4a0d-83a0-f953db3532d2`: D002 introduced itself as a general collaborator and had zero available Skills. Admin UI showed official role 1.5.0. Through the existing explicit selection and confirmation UI, only D002 was upgraded to 1.6.0; no other role was selected and no candidate Skill was promoted. The same introductory prompt in thread `thr-b8e5b785-f711-4c8c-971a-3ee4a555b2d0` then produced the correct research identity and methods, but incorrectly denied workflow availability and inserted an unnecessary task-intent approval. The introductory run subsequently displayed interruption by service restart; its cause is not established.

A representative task supplied three explicitly synthetic sources S1/S2/S3 and requested a research brief, evidence matrix, uncertainty, two hypotheses and follow-up research. Real model execution incorrectly attempted W029 instead of Research-to-Brief W001; the backend refused it. Direct Skills remained pending. Initial generated output invented quotations and event identifiers, then a second version corrected those omissions. Both visible reply history and the saved second draft retain a false 2024-10-02 generation date; the draft also repeats the wrong workflow number. These are failures, not acceptable evidence quality.

The tester used the product's “落地为产物（草稿）” action on the actual second model reply, named it `d002-onboarding-research.md`, opened it, refreshed the entire page, found it under the task inspector's artifacts, and reopened its fully rendered content. This proves user-assisted draft persistence, not autonomous file publication or workflow success. The artifact reports “未挂出处”; source labels inside prose do not substitute for governed provenance. Screenshots and full accessibility snapshots are retained alongside this report.

## Repair scope and limitations

1. Explicit official-role upgrades can now add newly published and verified authored Skills without requiring a role-pack semantic version bump. Existing pins must remain a subset; exact pack provenance, model, instructions, role fields and tool policy still gate eligibility. Existing immutable versions remain unchanged. Candidates, foreign pins and custom roles remain ineligible.
2. Executor system context receives the frozen role's workflow IDs and the existing authorized published workflow catalog (name/version/input schema), intersected with that frozen list. Unknown catalog availability is not falsely described as no authority. This context grants no permission and starts no workflow.

Thirty API protocol/repository tests passed, including both new captured executor-context cases. These use synthetic fixtures and do not prove model obedience or actual Skill certification. A PostgreSQL/HTTP regression was added for verified binding refresh, old-version immutability, non-admin/cross-org refusal, stale selection and idempotency; local Docker was unavailable, so that test requires CI evidence. No fixture verification status was applied to DevApp.

## Hard-gate status

D002 does not pass acceptance and is not assigned 9/10. Identity improved after the existing upgrade; Skill readiness, correct workflow execution, source fidelity, provenance and clean autonomous artifact delivery still fail or lack proof. User-assisted open/save/refresh recovery passed. Role switching, further approval and permission counterproofs, remaining roles, and ten-round physical bidirectional voice/P95 remain outstanding. No average score or mock/fixture result is used to fill these gaps.
