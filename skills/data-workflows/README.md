# W18 data analysis and visualization packages

Source for WX-S007/WX-S020. Reuses Anthropic knowledge-work-plugins commit
`1f517b9de47e827c80cd933ed364e16838072239`, Apache-2.0. Original skill files are
preserved byte-for-byte under upstream as `source.md`; the relative CONNECTORS.md reference
still resolves. Each generated package includes LICENSE and per-source digest/provenance.
WorkspaceX-authored entry points and one shared runtime reference define the offline
CSV/JSON/XLSX + static PNG/PDF subset. Optional upstream warehouse/notebook/Plotly paths
are explicitly unavailable unless separately supplied by a real authorized tool.

```sh
node --import tsx skills/data-workflows/scripts/build.ts
node --import tsx skills/data-workflows/scripts/build.ts --check
node --import tsx skills/data-workflows/scripts/verify.ts
```

Distribution reuses FileSkillStarterPackSource and existing authenticated import/pin
mechanisms. Configure SKILL_STARTER_PACK_ROOT to skills/starter-packs and select
`data-workflows / 1.0.0`. Absent root means no package. This source does not claim deployment,
user import, or real model behavior validation. No second skill storage/runtime is added.

The approved dependency profile is separately hash-locked in
apps/skill-sandbox/analysis/requirements.lock; actual offline image execution evidence
must pass before calling the analysis environment available.
