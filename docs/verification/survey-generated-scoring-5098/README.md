# Generated scoring configuration — #5098

Product SHA: f2301691a1121a103c7f87cc15a31fd86ed40092, based on freshly fetched main015f933. Same existing worktree and isolated runtime reused.

A real qwen3.8-max proposal previously applied a rating question without config and publication failed. This fix supplies the existing question factory defaults only for absent rating/nps/slider configuration. Explicit custom configuration, empty objects, and invalid ranges are preserved; explicit null remains rejected. No separate default constants are introduced.

## Verification

Regression before fix: three scoring tests failed, eleven passed. Final contracts suite: 45 tests passed across source, question types, Markdown proposal and survey tests. Isolated API proposal/file tests: 7 passed. Contracts typecheck, diff check, init.sh quick and pre-push20 affected typecheck/lint tasks passed. init.sh quick is not a full repository verification claim.

Final source was rebuilt from scratch: Next compile/types/124 generated pages/traces passed. Earlier build discarded after independent review changed null handling. API/Web final product SHA and source hash703d13905534cc2c977c33bcb2d29c0c4308de3fa773923e435103a5ccfa1da3 verified. All survey_* backup preserved12 workspaces/7 templates/3 attachments/1uploadsession; before/after counts equal. Runtime credentials and SQL backups are private, not committed.

## Real browser evidence

All interactions used Codex IAB tab13 at configured127.0.0.1:25898; capture calls were bound directly to that tab. A first mistaken localhost navigation failed login because its origin differed; corrected to configured origin without changing product or runtime. That attempt does not count as acceptance.

1. Actual dashscope/qwen3.8-max generation returned rating+nps+open Markdown with no config metadata. Preview shows actual provider/model and original generated text.
2. Applied to newly created own survey f730f963-75c2-46ef-9655-3341a09e3bef. Design renders1–5 stars and0–10 NPS; reload retains both.
3. Actual publication check reports service-confirmed readiness, then actual Start collection succeeds at version3.
4. Opened genuine published link, selected4 stars and NPS9, typed synthetic improvement text, clicked Submit and observed success.
5. Refreshed backend, opened the single persisted response528edbe4-9c1c-4762-a642-265eaafd190b, and observed values4/9 and the exact synthetic text.

No questions, responses or model output were seeded for this chain. QR excluded by human scope. Slider fallback is covered by contract regression; this real-model run generated rating and NPS only. This proves #5098 chain, not completion of the entire all-buttons matrix or CI green. No merge authorized.

## Capture hashes

- `fix5098-real-model-proposal.jpg` — SHA256 `92a4e77ddd54cd081d1bbbb528f832468add6e87775053e7b92565f0c90d8b71`
- `fix5098-real-model-proposal.txt` — SHA256 `e75fb3793489902c7366a6a98f01db5841d926dd3300a816c8368c4e1e4cf3e4`
- `fix5098-scoring-applied.jpg` — SHA256 `86aa53860d400316b7dab69d2b31cd9a86725777d436480ad0b09234fc341fd5`
- `fix5098-scoring-applied.txt` — SHA256 `df11d3adb7950967a36275bf96c4f65638a6353d962c7c36fddae171b9570a2c`
- `fix5098-publish-ready.jpg` — SHA256 `a36bd734d01014f49d2019acb7b4401ceeeb25846f8aa186391f87a7a67151a6`
- `fix5098-publish-ready.txt` — SHA256 `e1775b5fbbe701c9e90affc8018ee2b6b499056c1a4319513e66967cb546ecfd`
- `fix5098-public-filled.jpg` — SHA256 `4c7fbd8e71f0d3f80d5c4a73efba1a0808dde24382b13b390d22480b1d2fd448`
- `fix5098-public-filled.txt` — SHA256 `950aa4fedda049f988670a47b0889b21ee298938fe876013bbfe70b341327f91`
- `fix5098-submit-success.jpg` — SHA256 `1a051bd57d97c796b4d5fc2e759d43ac46f90a2da4e40e2eeed62adb4b3019a9`
- `fix5098-submit-success.txt` — SHA256 `ad0f6266cb429523cd97b935004d76e3f220fc500a739c53258f0f34c43cb91d`
- `fix5098-persisted-response.jpg` — SHA256 `9d8b2f3cadfbf96e02bba4093c1401d666a29004c499500606363b2b60dfdd90`
- `fix5098-persisted-response.txt` — SHA256 `d042807c584d2c4b2923d1bc8cb4045f62428f076ba0a40529bfb20efe82e410`
- `fix5098-scoring-reloaded.txt` — SHA256 `df11d3adb7950967a36275bf96c4f65638a6353d962c7c36fddae171b9570a2c`
