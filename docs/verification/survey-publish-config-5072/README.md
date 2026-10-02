# Survey publishing configuration diagnostics (#5072)

Production source commit: `f66907cd50c6c9430454347347dd4bb4ade01ccc`.
Baseline: `b57b0ba4f02cfdc020056595777af3214be45129`.
Date: 2026-10-02, Asia/Shanghai. Local isolated API 24898 / Web 25898.

The original current-main browser reproduction returned a generic publishing error for an image-single question without image URLs or alternative text. The existing shared validator already rejected this configuration; the fix exposes its diagnostics as targeted structured publishing blockers.

## Real browser retest

The production Web build compiled, passed lint/type checking, generated 124 pages, and started successfully. Its production source bytes match the implementation commit; the commit was created while the build was running, with no later production code changes.

On own test survey `9081bade-43be-4056-900e-26ff491202de`:

1. Clicked publishing check: one configuration blocker showed the specific missing image/alternative-text diagnostic. [Screenshot](fix5072-specific-blocker.jpg).
2. Clicked repair: design editor selected the affected image question. [Screenshot](fix5072-target-question.jpg).
3. Expanded the canvas content-edit disclosure; entered two HTTPS image URLs and both alternative texts through actual UI inputs. [Screenshot](fix5072-images-configured.jpg).
4. Clicked publishing check again: preparation succeeded and the start-collection action became available. [Screenshot](fix5072-repaired-ready.jpg).
5. Reloaded: prepared status remained. [DOM snapshot](fix5072-ready-persisted.txt).

No API or database mutation substituted for these browser actions. No microphone, QR action, production data deletion, or anonymity-rule change was performed.

## Automated validation

- Domain regression first failed: missing targeted blocker (1 failed / 7 passed).
- Domain + actual HTTP regression: 11 passed, including exact missing-image diagnostic and successful preparation after repair.
- Publishing UI regression: 12 passed, including selecting the second question from its repair action.
- Readiness regression: 2 passed.
- Independent reviewer rerun: 14 UI/readiness tests passed without cache; no P0/P1/P2 code findings for the implementation SHA.
- Contracts/API typecheck, API lint, affected Web lint, production Web build passed.
- `./init.sh` quick baseline check passed. Full `init.sh --full` was not run.

## Boundary

This validates issue #5072 only. The full 296-row survey button matrix remains incomplete. Anonymity contract issue #5067 is pending a human decision. A suspected absent image-edit control was disproved by expanding the content disclosure; #5078 was withdrawn as a false positive and no code was changed for it. This report does not authorize merge or mark the survey feature passing.

## Evidence hashes

- `fix5072-images-configured.jpg`: `ca580689d767d6c8fa7c122ed8e14c722116d747e2f3595ba9d862520a5bd30f`
- `fix5072-ready-persisted.txt`: `487431b8182f4f69ed35e855f80fa9346774862b56a86ed608fcddb09011d2e0`
- `fix5072-repaired-ready.jpg`: `2edd21eefb41e3d6b72d4ae1fcc70386e93fb7ece6d7842b9941197264d7bc94`
- `fix5072-specific-blocker.jpg`: `be57fbb6e554b2eeaf9a71c34462b0151e0ee445414d9144186a663a6ec9075b`
- `fix5072-target-question.jpg`: `96e519a58b47f863d5fc8472e3834d7bfa8d3d1476705e05588e364a194df0af`
