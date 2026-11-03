# Final-head CI correction

At 87677270810b673a78bffc995896542cf6eb1d64, run 41539138603 found two actionable regressions. The raw error text ratchet correctly detected projects-screen had reduced from two hits to one; decrease that exact baseline without changing rules. The existing empty-state fixture omitted required ProjectListItem kind/status/readOnlyReason fields. Constant lookup previously rendered undefined silently; translation now surfaced that invalid fixture. Give the fixture the canonical return type and all required fields, removing obsolete fields. Do not weaken translation, contract or empty-state assertions.

Local red: existing three-case file produced two failures/one pass with undefined.replace at projectKindLabel. Green: all seven cases across the existing empty-state and localization files passed; the ratchet passed at 55 files/79 hits. See durable red/green logs. Original real browser behavior and known P3 boundary remain unchanged.

After develop advanced through profile integration, merged the latest develop automatically without manual conflict resolution. Only the canonical Locale/entity-localization foundation changed relative to this branch; seven project/empty-state unit checks passed again. No product display or API payload changes in this integration. The coverage ledger now links the project PR and the separate TopBar geometry follow-up.
