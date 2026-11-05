# Readonly catalog test-startup review

Existing independent reviewer found no actionable P1/P2 for the canonical fresh owned PG-stack lifecycle. The candidate reuses existing readonly provisioning SQL and fixture-derived credentials, creates a separate scoped LOGIN with only app_platform_org_catalog_ro membership, rejects unexpected preconfigured credentials or existing authority, and sets the two catalog variables before Nest provider factory evaluation. It does not start enterprise acceptance, seed funds, register model adapters or change production DI/services/guards.

Applied binding independently verified: commit51e5899b52d99ed0484cec1cd1aab129d58614b1 changes exactly the reviewed startup file. Committed and working postimages both match75d2e76c933f423eae5365b09d1afa5058550c545ed3ba5744a1bee3ce429651. All supplied API type/lint/static/init/discovery receipts exit0; see catalog-fixture-source-gates.json.

Lifecycle limit is deliberate: retained PG/API restart fails closed on the scoped role. Use the existing fresh owned isolation wrapper and dispose the whole owned PG cluster/container; dropping only the database is insufficient. No silent adoption, ALTER or DROP of unknown authority is allowed. If retained infrastructure is required, it needs a separately reviewed ownership/reuse mechanism.

This is source review and binding only. Fresh actual provisioning/authentication/RLS, organization GET200, native recovery/locale/permission journey, all20 planned images and actual owned-stack cleanup remain pending. The two automatic failure screenshots from attempt1 are diagnostic and do not satisfy this acceptance.
