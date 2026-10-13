# Research / Interview workflow action evidence

Product source accepted at 253adc773962893f43f6ef10ee03fc8366fd107c. Final browser verification source: 7b282c849 (later commits only persist this evidence). Independent reviewers accepted the shared button and pending-state fixes. This is local production Next + actual login/API + tenant PostgreSQL saved-fixture evidence; no response interception or model generation.

- Web tsc passed; all changed component Next lint passed.
- Combined UI: 111 passed. Runs regression: 27 passed. New shared/interview interaction tests: 9 passed. Single-loading/transitions: 38 passed.
- Final study browser: 1 passed (3m13 execution; owned isolation cleanup 1s). Reports at 1280/768/375: no horizontal overflow; unique footer after content, no nested/fixed footer; native file and return buttons 36px; actual return routes verified.
- Interview six-step responsive browser and saved long-report reload: 2 passed on the same product code; source screenshots for this earlier run were ephemeral. The final report and enabled intake screenshots here are retained evidence.
- Both enabled primaries measured 36px, background rgb(32,31,29), text rgb(255,255,255), matching existing tokens. Secondary commands measure 36px, white background and dark text. Assertions wait for existing color transitions to settle.
- A future-lease busy plan saved fixture renders exactly one spinner and zero pulse skeletons. Steps show static numbers. No model command POSTs; agent_runs and model_request_starts both 0 before and after.
- Completed report fixtures retain PDF/Word entry eligibility. Uncompleted research reports retain the original completion action and hide file generation until eligible. No permission or model-flow changes.

Before images are live baseline captures; after images and computed metrics are from the final run. These fixtures contain synthetic study text, not real user transcripts or credentials. No merge or deployment was performed.

## CI assertion alignment follow-up

`bd9cdb4834caaa093c15b937f0542e364295600d` updates only the three pre-existing tests that asserted the old header controls/primary back button. Independent review accepted the stronger unique-footer/nonfixed/body-after/right-alignment checks and preserved generation/regeneration/saved-report assertions. Reference-layout UI: 20 passed; testid gate: all 4615 references resolved; gate counterexamples: 35 passed. The two affected real browser journeys passed (5m total, owned stack cleanup 1s), including generation and regeneration with the standard local loopback supplier. No external paid model was invoked.
