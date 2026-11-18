# AIDT backend bootstrap

AIDT is available by default in every environment. Normal platform bootstrap includes its verified skill packs; legacy `ENABLE_AIDT_MODULE` values no longer disable them. Existing organization and project permissions continue to apply.

The default `STANDARD_PLATFORM_PACKS` remains the ordinary platform catalog. Default bootstrap adds its release coordinate to the existing verified starter-pack importer, with the stable platform idempotency key and platform organization. It does not create an Agent, change the selected Agent/model, or modify tenant member permissions. Ordinary packs retain their existing import order and error isolation.

Legacy flags do not disable future imports or delete user content. Existing rows and user edits retain the verified importer's conflict and replay policy.

Tests in `tests/skill/aidt-backend-isolation.test.ts` use a mocked importer and a database port that throws if touched. They verify the bootstrap boundary and canonical import parameters, not PostgreSQL persistence, production installation, model behavior, or existing-row cleanup.

`aidt-backend-import-replay-isolation.test.ts` additionally runs the actual verified-pack import use case against in-memory persistence ports: fixed release replay does not create another version, content conflicts stay visible, and absent membership blocks import before material reads. PostgreSQL repository behavior is unchanged and still requires its existing real-database acceptance lane.
