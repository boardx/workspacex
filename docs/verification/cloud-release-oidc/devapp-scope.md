# Conservative DevApp deployment scope

`backend-gates` retains every existing required check and every deployment gate.
The existing hosted `gates-fast` job computes `skip_devapp`. Only the literal
`true` suppresses deployment, and only for a `push` to `refs/heads/main`.
Tags, manual main deployment and both authorized branch previews retain their
original behavior. This output is a scope decision, not a live candidate receipt.

The proof reads the actual push event's exact before/after commits, confirms the
checkout equals after and before is an ancestor, and examines the complete
NUL-delimited git diff. A nonempty diff must consist entirely of regular files
in the helper's exact release-control allowlist, with additions or modifications
and no executable-mode changes. Missing baseline/history, forced push, empty
range, failed git commands, deletion/rename, symlink, unknown path, application
or dependency changes all retain the original deployment path. There is no
API pagination or changed-file-count truncation. Oversized diff fails the bounded
read and retains deployment. The scope helper, its policy/workflow and all
`packages/`, `apps/` and dependency manifests are not exempted.

PR #5512 cannot currently qualify as control-only: it changes
`packages/cloud-deploy/src/cn-fast-safe-release.ts`, other unknown files and this
scope workflow. `apps/api/package.json` depends on `@repo/cloud-deploy`, and API
runtime storage/database configuration imports that package. No runtime package
exception was invented to avoid deployment. Ready/merge therefore still requires
separate approval covering DevApp's real build, migration/seed and restart effects.
This code does not authorize merge, deployment, queue cancellation or re-enabling
the legacy CN prepare workflow.

Validation:

- `node --test .harness/scripts/devapp-deploy-scope.selftest.mjs`: real temporary git
  repository tests for positive proof and counterexamples.
- `pnpm exec vitest run .harness/scripts/skill-files-preview-deploy.test.ts`:
  evaluates the actual workflow deployment expression and preserves all gates,
  serialization, exact-SHA Skill preview and tag/manual behavior.

The checkout and hosted runner retain their existing permissions. No root command,
credential handling, cloud access or workflow event was added by this gate.
