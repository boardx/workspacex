# Geometry follow-up on323cde98ea3e18772220a8d57cfedbe76b7c99d9

The fresh production build passed. The case reached and passed all step-label bounds checks for intake, plan, current report and report history at375/1280. The375 report screenshot was inspected and shows the complete English step label wrapping onto two lines.

The test then failed at metadata screenshot line157: the shared screenshot helper waited for `research-flow-progress` on the `/research` list, where that navigation does not exist. The failure snapshot contains the actual Research list and Edit research dialog. This is a test-helper route-contract error; timeout180s and retries were not changed. Full wrapper6m57s,cleanup1s,own scope wsx-6ee2b7c7e134ce4db180 dynamically checked0 containers after exit1.

Correction: the known list route explicitly asserts navigation count0; every step route explicitly asserts count1 and retains all three labels' scrollWidth/clientWidth and containing-li bounds checks. No product file changed for this correction. A new full fresh-production run is required before acceptance.
