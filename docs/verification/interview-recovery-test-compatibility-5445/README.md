# Main integration regression compatibility (#5445)

Fresh main eeba4e77 merged source-only recovery and direct denial correction. Its test still asserted that historical synthetic26493 report's valid denied strength claim rejects. Baseline1FAIL/393; the correction makes that finite grounding denial legitimate without proving the whole report normal.

Test only: leave the historical raw/source fixture unchanged, generate a distinct candidate with explicit affirmative strength overclaim, and assert the original gate rejects it. Preserve one saved-failure call and exclusion of historical failed body from model input. GREEN393. No production/gates/raw/source/CAS/call-cap changes and no actual provider request.
