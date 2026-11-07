# Shadow impact baseline — issue6062

Observed baseline is the successful #6059 actual queue candidate8008071570751014d2da9a98e53d2062d16795c1, acceptance run41202350309. queue-baseline.json retains job timestamps/conclusions, not summed runner time. One sample does not establish p50/p95. Stage1 reports plans only; all existing verification commands and needs remain mandatory. Initial module inventory is deliberately partial: unclassified/shared paths select full-regression, never an empty suite list. No cross-SHA reuse is enabled.

Validation covers scoped billing, identity downstream propagation, shared/unknown fallback, policy identity, real Git rename/delete paths, invalid base/reversed ancestry/empty diffs, and existing queue wiring. Coordinator tick is unavailable because COORD_GATEWAY_URL is not configured; no authority/lease was fabricated. Direct user work is tracked in issue6062.
