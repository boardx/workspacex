# Shared admin navigation — #6186

Organization/platform sidebar titles, intros, four groups,22menu labels, count accessible names and unavailable explanations now switch zh-CN/en in place. Metadata defaults, keys, URLs, UCrefs, scopes and AI-group sentinel remain byte-identical; two existing navigation titles move by reference into one typed namespace. Source query/role/provider behavior is unchanged; em dash still differs from0.

Validation: fresh2red tests before implementation; final61regressions/8files39.70s; canonical snapshot byte comparison; targetESLint/specgate/Webtypecheck/init0. Independent task review clean. Final Astra review caught one browser-only assertion using the whole link without its count; strict combined label+dash and exact count-name assertions close thatP2, scoped re-review confirms no residual issue.

Fresh production browser passes1/1 (3.0s case;4m32total including1scleanup), real API/PostgreSQL, existing entity-localization actor and registered spec. It proves organization nav language/current/href/no-count-refetch/reload, platform real403 with preserved nav scope/counts,1280/820 screenshots. Both screenshots were visually inspected. At375px the existing AppShell policy hides its left panel; that behavior is explicitly asserted and no mobile drawer is added.

Platform body text remains a subsequent B8 slice; its Chinese forbidden panel is deliberately visible in the screenshot. This slice does not claim privileged platform writes, all backend pages, prototype branches, or production deployment. Existing namespace/state tests do not replace newhead CI and its actual native candidate.

Evidence logs and final/scoped reports are alongside this file. The browser command selects only this new case with--no-deps locally; CI keeps the complete unconditional registered project closure. Scopewsx-2fb27ada717bf87472b0 running containers0 after cleanup. Heavywindow remains held only through normalpush, then explicitly returns to phase1.
