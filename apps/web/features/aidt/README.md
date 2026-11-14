# AIDT optional module

AIDT lives inside WorkspaceX. It has separate routes, UI state, teaching metadata and host adapters; it consumes the existing Chat, Project, resource, recording and Design capabilities. It does not define a new ProjectKind or grant extra permissions.

## Public boundary

- `public.ts`: pure configuration and project-profile/route metadata; no React, SDK or API runtime dependencies.
- `entry/home.tsx`, `entry/workspace.tsx`, `entry/board-return.tsx`: explicit UI entry adapters.
- `components/` and `lib/`: private teaching implementation.
- `@/lib/project-aidt` and `@/lib/aidt-module-config`: thin compatibility re-exports only.

Shared Chat/recording/Design code must not import this module. The architecture test scans imports, re-exports, dynamic imports, relative paths and facade bypasses. Global member text communication remains a shared capability, outside AIDT; this change does not implement real member transport.

## Opt-in

Both switches are off by default. For an isolated development/preview environment:

- Build Web with `NEXT_PUBLIC_ENABLE_AIDT=1`. It is a Next public build-time switch: changing only a running server environment does not update an already-built client.
- Start API with `ENABLE_AIDT_MODULE=1` to permit the existing verified AIDT skill-pack bootstrap. Restart the process after a configuration change.

Disabled Web routes call `notFound()` before dynamically loading teaching UI. Navigation and ordinary project lists keep their original destinations; historical tagged projects remain accessible through the ordinary Project route. Ordinary Studio `step` parameters are not interpreted as teaching context; returning to AIDT requires explicit `aidtStep` and project context.

The API switch stops future automatic imports; it does not delete existing skill rows, revoke capabilities, or change user content. When enabled, the pack still uses the existing platform catalog. A course-only publication scope needs separate design review. Neither flag is an authorization check.

## State and services

Drafts remain page-local and are partitioned by organization, user and project. Token refresh preserves the same student's draft, while resource authorization is rechecked using the current bearer and write capability. Old async responses must not unlock a new actor's editor. Confirmations in the UI are not shared backend stage state.

Teaching Chat uses canonical Shell/composer/messages through its existing host extension. Only this module owns welcome copy and teaching context. A cancelled host stops later initialization mutations; already accepted backend work is not claimed to have been rolled back.

This isolation work adds no endpoint, migration, database, tenant permission or deployment. Shared structured saves, actual member messaging, real model/ASR and classroom acceptance remain tracked separately in the Backlog.

## Validation

Integration is an acceptance requirement, not just matching visual styling. Reuse Project membership/resource authorization, canonical Chat and Skill mounting, existing research/transcription entry points, Artifact provenance/versioning, Board handoff and Design Workbench. Carry the current project, authorized actor, resource, stage and return location across each handoff. Resource ownership and Board roles remain independently enforced by their existing services.

Member text communication is a product-wide capability available alongside stage work; keep its messages separate from the AI facilitator and from confirmed stage outputs. Actual member transport is still outstanding. Personal transcription and Chat voice drafts must not bypass interview recording consent or be misrepresented as interview evidence. Check existing APIs before proposing new shared-state or messaging contracts. Validate the complete handoff journey and ordinary module regressions; a tool link alone does not establish successful integration.

Run `apps/web/tests/aidt-module-boundary.test.ts` and `tests/ui/aidt-module-compatibility.test.tsx` together with the AIDT and ordinary Chat/Project regressions. The backend no-database lane is `pnpm --filter @repo/api exec vitest run --config vitest.aidt-isolation.config.ts`. Unit/in-memory results are not PostgreSQL, microphone, model or 30-person classroom acceptance.
