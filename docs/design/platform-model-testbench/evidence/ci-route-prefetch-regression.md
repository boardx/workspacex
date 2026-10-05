# CI route-prefetch regression diagnosis

Run 37280447336, fullstack-smoke job 111667035462, artifact 11332291896.

The six original/retry Playwright traces for canvas-template-create, capability-mutate and skill-create all show HTTP 404 and resource console errors on GET `/platform-admin/model-tests?_rsc=...`. The tests completed their main operations; their unchanged final console-error assertions exposed this additional failed navigation prefetch.

The artifact's `phases/phase-01-run-a-project/evidence/ci/runtime.log`, lines 1753–1760, shows both the dynamic `/platform-admin/[module]` generating `/platform-admin/model-tests` and the real standalone `/platform-admin/model-tests` page in the same normal Next production build. This disproves the initial hypothesis that a CI-only minimal-build allowlist omitted the page. The product route registry had added the standalone destination to the full navigation map, while `generateStaticParams()` still generated every destination through the dynamic module page. Its screen map has no model-tests component and calls `notFound()`.

The fix separates dynamic module destinations from standalone page destinations in the existing route metadata source. The complete navigation map remains their union; the dynamic page generates and resolves only its owned module destinations, retaining existing redirects. The standalone model-tests page remains intact. Prefetch and console assertions are unchanged. No CI whitelist, mock response, production credential or authorization changes were added.

Three pure regression tests check the standalone file and navigation destination, all ten previous dynamic destinations and redirects, and an independent filesystem oracle showing that the former full-navigation algorithm collides with a standalone page. The existing fourteen route/scope tests pass. No local production build, database or fullstack service was started; the corrected SHA still requires normal CI browser verification.
