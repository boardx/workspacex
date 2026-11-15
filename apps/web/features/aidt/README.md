# AIDT optional module

AIDT lives inside WorkspaceX. It has separate routes, UI state, teaching metadata and host adapters; it consumes the existing Chat, Project, resource, recording and Design capabilities. It does not define a new ProjectKind or grant extra permissions.

## Public boundary

- `public.ts`: pure configuration and project-profile/route metadata; no React, SDK or API runtime dependencies.
- `entry/home.tsx`, `entry/workspace.tsx`, `entry/board-return.tsx`: explicit UI entry adapters.
- `components/` and `lib/`: private teaching implementation.
- `@/lib/project-aidt` and `@/lib/aidt-module-config`: thin compatibility re-exports only.

Shared Chat/recording/Design code must not import this module. The architecture test scans imports, re-exports, dynamic imports, relative paths and facade bypasses. Global member text communication remains a shared capability, outside AIDT, consuming its own authorized API rather than importing teaching internals.

## Opt-in

Both switches are off by default. For an isolated development/preview environment:

- Build Web with `NEXT_PUBLIC_ENABLE_AIDT=1`. It is a Next public build-time switch: changing only a running server environment does not update an already-built client.
- Start API with `ENABLE_AIDT_MODULE=1` to permit the existing verified AIDT skill-pack bootstrap. Restart the process after a configuration change.
- Member communication has an independent default-off pair: build Web with `NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT=1`, start API with `ENABLE_PROJECT_MEMBER_CHAT=1`. The persistent launcher lives below SessionProvider, so it is available across authenticated pages and preserves unsubmitted drafts across navigation.

Disabled Web routes call `notFound()` before dynamically loading teaching UI. Navigation and ordinary project lists keep their original destinations; historical tagged projects remain accessible through the ordinary Project route. Ordinary Studio `step` parameters are not interpreted as teaching context; returning to AIDT requires explicit `aidtStep` and project context.

The API switch stops future automatic imports; it does not delete existing skill rows, revoke capabilities, or change user content. When enabled, the pack still uses the existing platform catalog. A course-only publication scope needs separate design review. Neither flag is an authorization check.

## State and services

Unsubmitted edits are page-local and partitioned by organization, user and project. Explicit shared saves use the approved AIDT stage API, append-only PostgreSQL revisions, expectedRevision CAS and actor-scoped operation IDs. Reloading restores unedited forms; conflicts preserve the local draft. The sixth stage can carry a separately saved group report and its actual source revisions. Token refresh preserves the same student's edits, while resource authorization is rechecked using the current bearer and write capability. Old async responses must not unlock a new actor's editor. Saving does not confirm a group decision or stage completion.

Teaching Chat uses canonical Shell/composer/messages through its existing host extension. Only this module owns welcome copy and teaching context. A cancelled host stops later initialization mutations; already accepted backend work is not claimed to have been rolled back.

The approved A+B increment adds stage/member-message endpoints and two additive migrations, reusing the existing API process and PostgreSQL. It does not deploy a new service, change existing role assignments or use AI messages as human transport. Human messages have server receipts, per-project ordering, stable retry IDs and single-level topics; visible panels poll incrementally about every five seconds. This is not P2P, a voice room, delivery-to-device acknowledgement or read receipts. Feature flags grant no permissions.

Personal Artifact checkpoints remain separate and private; they never migrate into shared drafts automatically. Shared image references are validated against actually sent, project-owned plenary Chat attachments and read with the native authenticated image path. Local image previews cannot be silently saved as shared attachments. Existing Artifact/Board/Design and transcription resource boundaries remain authoritative.

General-project interview recording is explicitly outside this A+B increment, following the user's decision to schedule it separately. Personal transcription, Chat voice input and externally supplied interview notes are not represented as that missing recording/consent loop. The C review remains a proposal. Real provider/model quality, microphone/ASR and classroom acceptance remain distinct checks.

## Validation

Integration is an acceptance requirement, not just matching visual styling. Reuse Project membership/resource authorization, canonical Chat and Skill mounting, existing research/transcription entry points, Artifact provenance/versioning, Board handoff and Design Workbench. Carry the current project, authorized actor, resource, stage and return location across each handoff. Resource ownership and Board roles remain independently enforced by their existing services.

Member text communication is a product-wide capability available alongside stage work; keep its messages separate from the AI facilitator and from confirmed stage outputs. Personal transcription and Chat voice drafts must not bypass interview recording consent or be misrepresented as interview evidence. Check existing APIs before proposing new shared-state or messaging contracts. Validate the complete handoff journey and ordinary module regressions; a tool link alone does not establish successful integration.

Run `apps/web/tests/aidt-module-boundary.test.ts` and `tests/ui/aidt-module-compatibility.test.tsx` together with the AIDT and ordinary Chat/Project regressions. The backend no-database lane is `pnpm --filter @repo/api exec vitest run --config vitest.aidt-isolation.config.ts`. Unit/in-memory results are not PostgreSQL, microphone, model or 30-person classroom acceptance.
