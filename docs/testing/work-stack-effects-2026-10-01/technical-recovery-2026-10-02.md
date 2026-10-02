# Runtime technical recovery — issue #4948 / PR #4917

The general assistant now exposes its trusted server-resolved skill scope in the member profile. The chat mount panel retains saved general-assistant mounts, including older immutable versions. Unknown or absent scope still selects exact agent pins; a label or client flag cannot grant general scope. Execution and directory projection share one stable-identity resolver. The isolated general-assistant browser fixture uses the reserved default identity.

The guided-research browser acceptance waits for the apply command HTTP acknowledgement before reloading; navigation otherwise aborts its pending write. Its stored-topic assertion stays unchanged.

Validation on the local repair candidate based on `9add7c03d0ef9ac613cec8913ff748f684a14048`:

- Mount-panel role scope and auto-close: 2 files, 21 tests passed, including missing-scope fail-closed and older mount preservation.
- Scope resolver and directory: 4 files, 48 tests passed; profile controller additionally asserts trusted default/general and authored role/pins projection (9 tests passed).
- Real production Next build, PostgreSQL/API and browser: digital-human dependency and core journey 03 both passed (2/2, zero skipped, 3 minutes). The journey imports a skill through the local GitHub upstream, persists its mount across reload, executes it, and checks one assistant reply. Standard isolation cleanup completed.
- Local browser config changes only startup budget and selects the mounted-skill specification plus its original digital-human dependency. It does not change assertions, fixture requests or production code, and is not shipped.

Raw local outputs: `/private/tmp/sop4917-ui-rerun.log`, `/private/tmp/sop4917-api-rerun.log`, `/private/tmp/sop4917-profile-projection.log`, `/private/tmp/sop4917-mounted-browser.log`. These paths describe this run; rerun through the standard isolation wrapper and the committed specs for reproducibility.

This technical recovery does not establish real vendor speech connectivity, production deployment, model professional quality, or completion of the 200-skill inventory. The guided-research ACK change has not yet been replayed in the full seeded browser lane. CI and independent review must bind the resulting commit SHA before merge.
