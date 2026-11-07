# Admin overview localization source coverage

Issue #6273. Complete /admin fixed display source prepared: organization overview, metrics, limit/audit events, first-value funnel, all state/aria/help text and disabled export/report reasons. Three components, compatible exhaustive provenance label authority, paired locale namespace and two registrations. Raw audit content, organization scope, requests/guards, metric/time math and disabled exports preserved by independent source review.

Independent light review spec/quality PASS, no new P1/P2, exact seven-source hashes bound. Functional tests, types, lint, native/browser/CI acceptance are UNRUN in this source-first phase. Normal source commit/publication hooks remain required; no stage completion or green merge claim. Continue /admin/local next without waiting CI.

Source report and hash manifest kept in private plan directory. Prior6270 source9b190 preserved independentbranch; both go through one normal publication attempt with mandatoryhooks and Draft only, failures deferred rather than rerun.


## 2026-11-05 CI repair requested by user
Reproduced the exact overview-live failure from run 41997358224: the legacy assertion expected raw `limit-boom`, while the shared describeFailure contract intentionally projects unknown failures to localized user copy. Updated the failure regression to cover zh-CN/en headings and reasons, reject raw exception leakage and fake/empty events, and retain independent successful usage rendering. Product error handling is unchanged.
Both overview suites pass (17/17), including after integrating latest develop; targeted test lint passes. Resolved only the two locale registry insertion conflicts, preserving accepted develop registrations and this PR's admin-overview namespace. Remote CI/browser acceptance remains pending; no completion or merge claim.
