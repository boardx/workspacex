# Deep Research prototype fidelity QA

**Status:** passed

## Scope

- Reference: `/var/folders/l8/7z3_dshd7799phy86_sry5k40000gn/T/codex-clipboard-4ad4b27d-fd5e-4db5-94e2-957816441648.png`
- User direction: retain the Workspace global rail, remove the extra research-specific left menu, and keep generated artifacts Markdown-backed.

## Browser evidence

At 1440 × 1000 Chromium, all six stages render without horizontal overflow:

- `apps/web/test-results/guided-research-prototype--645a6-on-without-desktop-overflow-chromium/prototype-home.png`
- `apps/web/test-results/guided-research-prototype--deae1-on-without-desktop-overflow-chromium/prototype-import.png`
- `apps/web/test-results/guided-research-prototype--fa75e-on-without-desktop-overflow-chromium/prototype-topic.png`
- `apps/web/test-results/guided-research-prototype--cdc33-on-without-desktop-overflow-chromium/prototype-plan.png`
- `apps/web/test-results/guided-research-prototype--41097-on-without-desktop-overflow-chromium/prototype-research.png`
- `apps/web/test-results/guided-research-prototype--5a7ad-on-without-desktop-overflow-chromium/prototype-report.png`

The native browser accessibility tree was checked for the report route: all six progress steps, actions, outline, Markdown report body, source metrics, and evidence-limit notice are exposed.

## Result

- No second research navigation rail is introduced.
- The six stages now use the reference's list, intake, topic, planning, research-operations, and report-document compositions.
- Markdown remains the source representation while the UI adds stage-appropriate hierarchy and actions.
- No P0/P1/P2 mismatch found within the approved scope. System-token differences from the image and removal of its research-local menu are intentional.

## Commands

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx tests/ui/guided-research-visual-contract.test.tsx tests/ui/guided-research-markdown-workspace.test.tsx tests/ui/guided-research-flow.test.tsx
pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project seeded-github-import guided-research-runtime.spec.ts
```
