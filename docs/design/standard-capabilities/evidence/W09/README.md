# W09 Office package migration and bounded edits

Four original creation instructions remain the source in office-docs-skill-content.ts.
The package builder adds native name/description frontmatter, scripts and a scope/QA
reference; all bytes and manifest entries are hashed and validated by TrustedSkillPackage.
Resources live beside the builder in scripts/office-package-resources and must ship with
that module. No extra library or replacement creation engine was introduced.

Distribution remains ensurePlatformSkillsSeeded, the existing platform-owned skill route.
Within its transaction a skill row lock serializes publication. An identical package
digest creates no version; changed service-managed content creates a new published version
through wave2_publish_skill_version. Existing published version rows and pins are never
updated. The compatible initial v1 ID remains for first-time seed; upgrades use the package
digest ID. A latest administrator-created version is not superseded by startup seeding.
Existing skill enabled/disabled state is not reset. No alternate starter import route or
permission system was added.

## Verification

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/skill/office-full-packages.test.ts tests/skill/platform-owned-skills-real-stack.test.ts tests/skill/office-docs-starter-pack-source-guard.test.ts tests/skill/office-docs-cjk-guidance.test.ts
```

Final 32/32 tests, exit 0, wrapper cleaned its stack. Earlier isolated package tests
exercise legacy-first migration; full regression includes already-initialized platform
skills and concurrent repeated seed. Raw logs are packages-platform-tests.txt and
packages-upgrade-tests.txt. Immutable legacy file bytes remain unchanged; existing
platform read/organization isolation tests pass. This does not claim a new end-to-end
historical agent pin execution fixture beyond those existing regression paths.

For the real sandbox test, prepend `globalThis.officeResources = <JSON object mapping
resource filename to actual UTF-8 file content>;` to the tracked
apps/skill-sandbox/tests/office-packages-container.mjs, then:

```bash
docker compose -p wx-office-packages -f apps/skill-sandbox/docker-compose.sessions.yml run --rm -T --entrypoint node skill-sandbox-sessions --input-type=module < /private/tmp/office-container.mjs
docker compose -p wx-office-packages -f apps/skill-sandbox/docker-compose.sessions.yml down --volumes
```

Exit 0; packages-sandbox.txt records real generation and editing of DOCX/PPTX/XLSX/PDF
using installed libraries inside the hardened session. Word/PPT replace one unique entire
text node; every other ZIP entry remains byte-identical. Excel literal cell change preserves
the tested other-sheet value and requests recalculation on open (no engine recalculation
claimed). PDF page-copy order is verified by distinct page dimensions and count. All four
outputs are read back over UDS. Self-owned container and volume were removed.

## Remaining boundaries

No visual rendering was performed in this increment. Real renderer installation and
page QA are a separately authorized next task. OOXML split runs/ambiguous text, arbitrary
layout editing, macro/signature preservation, arbitrary Excel complex-feature roundtrips,
PDF body editing/form preservation and secure redaction are not promised by these scripts.
T032-style source proof is unrelated and not claimed. Structural checks are not render QA;
this increment does not mark the entire W09 capability complete.

## Review corrections: risk and source deployment

The package adds no `risk_level` declaration. Renaming/importing the original body or
packaged body therefore retains the existing L1 default; the platform catalog's separate
existing stable-name rule is not changed. `office-full-packages.test.ts` asserts both.

The actual API deployment is source based, not a Docker/dist bundle:
`vm/deploy.sh` checks out FETCH_HEAD; `vm/provision.sh` starts
`pnpm --filter api run start`; `apps/api/package.json` starts `tsx src/main.ts`.
The new resource directory ships in that same checkout. No second embedded script copy
or invented Docker COPY step is introduced. A future compiled API deployment must preserve
these adjacent resources; it is not covered by today's source-deployment evidence.

```bash
pnpm --filter @repo/api exec tsx scripts/verify-office-package-deployment.ts
```

Exit 0 (`packages-source-deployment.txt`). The verifier asserts the real deployment entry
points, copies the actual builder, recipes and resource directory into an isolated release
layout, and launches a fresh tsx process from that directory. All four packages read their
real adjacent script bytes successfully; the temporary layout is removed. Dependencies
are linked to the installed workspace dependency tree, as this tests source asset packaging,
not an independent dependency installation or a production server startup.

Post-review database regression: the same four-file isolated command above passed 32/32
again, including the new original/package risk-default assertions. Full output is
`packages-review-tests.txt`; wrapper exited 0 and removed its own database/Redis/MinIO
containers, network and volumes. This run supersedes the earlier package digest evidence
where the removed frontmatter risk declaration changed content hashes.
