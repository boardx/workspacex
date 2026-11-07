First native browser attempt — failed
=====================================

Measured source cb933851f59127646052ec0ad67ed099d65152ec; frozen head 32d701a31bf903e8c3b4b93086d48185ac3720ca. Actual runner exit 1 in 365.823s, case failed in 30.813s, retry/skip/flaky zero. This is not final acceptance.

The operator roster capture at entity-localization.spec.ts:1109 (caller1199) required the complete member row in the viewport. At 375×900 its measured ratio was 0.704845786. The failure screenshot visibly shows the platform-admin badge and registration date squeezing the flex identity column into nearly one-character lines, making the row taller than the viewport. Root inspected both automatic failure screenshots; raw logs/report/traces/images remain private. Twelve PNGs were produced: ten planned captures and two automatic failure images, not sixteen final images.

The case reached this failure after successful real login, locale continuity, target role PATCH/readback/reload, LAST_ADMIN409/unchanged readback, UI grant201/readback/reload, and operator role PATCH/readback/reload. Later revoke and ordinary-admin denial remained unexecuted. Existing assertions and budgets will remain unchanged for the responsive-layout fix.

Owned scope containers/volumes/all eleven listeners were zero after actual exit. The shared test window was released before diagnosis and archival.
