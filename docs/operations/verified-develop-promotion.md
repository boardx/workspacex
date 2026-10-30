# Verified develop promotion

Develop is the integration source. Feature PRs and develop push validation retain complete verification. A release PR must originate from the same repository's develop branch and target main or main-us. Its actual synthetic merge tree must exactly match the validated develop source tree. A merged production push must also have that same tree and a unique merged develop promotion PR.

Promotion admission executes the target baseline's policy, not the candidate's policy. Changes to admission policy or its workflow/dependency boundary force ordinary validation; the initial installation therefore requires a complete run. A missing, failed, unfinished, stale, cancelled, skipped, ambiguous or unavailable evidence lookup for an identified pure promotion blocks admission and causes the required checks to fail explicitly. It must not fall back to partial PR checks and merge before develop integration finishes. Extra source changes and conflict resolutions with different tree content run the original checks.

Both harness and backend develop push evidence must identify the exact source, workflow and latest run attempt, contain all required successful jobs and retain usable artifacts. The required PR check names remain stable and produce actual successful evidence-validation steps on promotion; a skipped required job is not accepted. Merge metadata checks still execute. Evidence source links remain visible in workflow summaries.

Reuse does not authorize production data migration or server activation. Reuse the existing image-release immutable-tag path where applicable; retain each environment's configuration, migration admission, health and runtime smoke verification. A matching Git tree does not demonstrate payment settlement, credit cutover or model usage behavior on a production host.

Verification commands and counterexamples are recorded in evidence/verified-promotion-6040 and issue #6040. Actual elapsed time savings require a subsequent qualifying promotion run; unit tests and workflow edits alone are not runtime timing evidence.
