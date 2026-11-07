# Headed E2E regression repair — #5976

2026-10-29, Asia/Shanghai. Source candidate: `6b217019c9b741d601d427adf0526b0b7fc9b485`, based on `cd0e33e5e9a3bcbed609920d1bdbccf4818eb858`.

All ten previously failed cases have now passed. The focused fullstack run passed **11/11** (including adjacent desktop/mobile, normal access and Skill selection regressions), and the original HTML file passed **5/5**. These results do not replace a new full 342-case run or real-model acceptance.

## Causes and changes

- Two Board failures: headed Chromium on Retina macOS emitted one trusted wheel event with twice the requested CDP delta. A minimal native Fabric reproducer failed with the default launch, then passed with `--force-device-scale-factor=1`. The base browser configuration now fixes display scale. The application viewport algorithm and exact immediate-reload/cross-user assertions remain unchanged.
- Two HTML failures: locator clicks used unscaled bounds inside a transformed, sandboxed iframe and missed the visible target. The test now maps local coordinates through the displayed iframe bounds and uses a physical mouse click. The original selected-ref, clearing, structure invalidation and preview navigation assertions pass. No application bridge change.
- One project probe: an organization lead without project membership correctly receives `403 / NO_PROJECT_ROLE`. The obsolete screenshot expectation now verifies the HTTP refusal, visible access-denied panel and absence of result contents; no role grant or authorization change.
- Five GitHub-related failures: the prior `IMPORT_FETCH_TIMEOUT` did not recur. The original real public GitHub directory/single-file imports, file editing, trial and chat-execution assertions passed without timeout changes, proxy bypass or mock substitution. This is recovery evidence, not proof that upstream network timeouts cannot recur.

## Verification

| Verification | Result | Evidence |
|---|---|---|
| Headed fullstack focused run | 11 passed, exit 0, 3m55s including setup | [log](fullstack.log), [JSON](fullstack-results.json), [exact temporary configuration](fullstack-executed-config.txt) |
| Original headed `design-html.spec.ts` | 5 passed, 28.5s | [log](html-green.log), [diagnosis](html-diagnosis.json) |
| Original HTML failure | Missing selected-ref UI | [error context](html-red-error.md) |
| Native wheel reproducer before/after | RED exit 1, GREEN exit 0 | [red](wheel-red.log), [green](wheel-green.log) |
| Web typecheck | Exit 0 | [log](typecheck.log) |
| Web lint/design lint | Exit 0 | [log](lint.log) |
| Independent code review | No actionable findings on candidate source | Recorded in PR description |
| Owned stack cleanup | No remaining containers | [check](cleanup.txt) |

The focused command used the repository isolation wrapper, a fresh production Web/API/PG stack, one headed worker, no project failure propagation and no added retry. The archived configuration identifies the exact selected projects and files; output paths are local provenance, not portable deployment settings. Deterministic model/ASR upstreams were used; GitHub imports used the real public upstream. HTML uses the repository's dedicated frontend fixture lane, not a live business API.

Full local traces, screenshots, minimal reproducer and generated HTML are retained under `evidence/e2e-all-visible-20261028/repair-{final,html,board-baseline}/`. This committed package retains command results and diagnosis for reviewers without importing the large local trace archive.

This is one ad-hoc fix PR for the reported regression batch, not a new feature delivery. Refs #5976 and #5975. Business source, permissions, SSRF checks and model configuration were not modified. PR CI status is tracked separately from these local results.
