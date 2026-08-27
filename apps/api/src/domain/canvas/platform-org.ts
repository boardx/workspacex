/**
 * Re-exported, not declared here anymore — design-delta `platform-owned-skills`
 * (2026-08-27) moved the one declaration to `domain/org-id.ts`, since the value isn't a
 * canvas concept: it's the platform org itself, now also read by `skills`/
 * `skill_versions`/`skill_version_files`/`capability_listings`, not just
 * `canvas_templates`. See that constant's own doc comment for the full reasoning.
 * Existing importers of this module keep working unchanged.
 */
export { PLATFORM_ORG_ID, isPlatformOwned } from "../org-id";
