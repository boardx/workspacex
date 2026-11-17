# Optional AIDT backend bootstrap

`ENABLE_AIDT_MODULE` is **off by default**. Only exact `1` or `true` enables the shipped AIDT skill pack during normal platform bootstrap. Web entry points independently require `NEXT_PUBLIC_ENABLE_AIDT`; a browser flag does not grant backend permissions.

The default `STANDARD_PLATFORM_PACKS` remains the ordinary platform catalog. Enabling AIDT adds its release coordinate to the existing verified starter-pack importer, with the stable platform idempotency key and platform organization. It does not create an Agent, change the selected Agent/model, or modify tenant member permissions. Ordinary packs retain their existing import order and error isolation.

Turning this flag off stops future automatic AIDT imports, including an explicit AIDT coordinate passed to the bootstrap helper. It does not delete/disable already imported rows or revoke previously installed user capabilities. Existing rows and user edits need a separately reviewed lifecycle policy; a deployment flag is not an authorization or data-deletion mechanism.

Tests in `tests/skill/aidt-backend-isolation.test.ts` use a mocked importer and a database port that throws if touched. They verify the bootstrap boundary and canonical import parameters, not PostgreSQL persistence, production installation, model behavior, or existing-row cleanup.

`aidt-backend-import-replay-isolation.test.ts` additionally runs the actual verified-pack import use case against in-memory persistence ports: fixed release replay does not create another version, content conflicts stay visible, and absent membership blocks import before material reads. PostgreSQL repository behavior is unchanged and still requires its existing real-database acceptance lane.
