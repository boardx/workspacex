# Image contracts source boundary (#6124)

Failure: image-release run 41416758048, develop source
`e676c171e28a0adc1ea649214fb82daa6980beb2`. API job 125182733136 and Web
job 125182733293 both fail contracts typecheck with TS2307 for
`phases/phase-21-billing-payment/design-deltas/team-enterprise-v1/operations.proposal`.
The subsequent unknown-value errors are consequences of the unresolved import.
Both Dockerfiles copy packages but intentionally omit phase design documents.

The image check now uses contracts `tsconfig.release.json`, extending the same
strict compiler settings and checking every `src/**/*.ts` file and its imports.
The existing full `typecheck` command still checks source, scripts and tests.
API's own release check and Next's build/typecheck remain required.

Reproduction and regression:

- `node --test tests/contracts-release-typecheck.test.mjs` creates an isolated
  package copy without phases. Full typecheck must reproduce the missing proposal;
  release typecheck must pass; an injected source type mismatch must fail TS2322.
  Both image entrypoints and preservation of the full repository command are checked.
- `python3 -I -B tests/test_web_standalone_packaging.py` checks standalone packaging.
- `pnpm exec vitest run .harness/scripts/vm/api-docker-workspace-context.test.ts --maxWorkers=1 --minWorkers=1`
  checks the API's transitive workspace COPY closure.

The dedicated web-runtime-contracts workflow executes the dynamic regression on
changes to either Dockerfile or contracts. These checks do not establish successful
image publication, activation, runtime artifact readability or browser acceptance;
those require the real exact-source release workflow.
