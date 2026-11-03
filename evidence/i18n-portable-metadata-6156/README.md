# Portable display metadata — #6156

Directly assigned i18n scope; no feature status or human signoff is changed.

The v2 envelope carries typed source language and bilingual display fields. Legacy v1 package schemas, bytes and coordinates remain readable. Original names, files, instructions and frozen execution configuration remain the source of execution truth. Imports verify the envelope before replay, write metadata atomically, and preserve manually maintained copy and manual clear tombstones. Exports capture immutable published versions and reviewed copy; unavailable Agent pins fail closed. Exported files and per-file digests are preserved; the new portable envelope receives its own digest.

The authored display release derives 86 Skill and seven Agent titles from requirement headings, pins the current compatible official Skill dependencies, and keeps metadata versioning separate from execution upgrades. New installs can receive the bilingual package. Already installed organizations see an explicit **Update display translations** action in the existing administrator surface. This action does not install, enable, republish or upgrade execution definitions. Original custom fields, manually edited translations and manual clear tombstones are preserved. The legacy official-role offer DTO is unchanged; scoped new clients read the independent administrator metadata offer.

Verification:

- `pnpm --filter @repo/api exec tsc --noEmit`: exit 0.
- Contract tests: 21/21, including strict v1/v2 and metadata tampering.
- API unit tests: 33/33, including immutable legacy packages, canonical source fingerprints, long export identities, permission/version conflicts and edited-original preservation.
- Real isolated PG/HTTP: 21/21, including all nine current bilingual Work packages imported together, seven matching official Agents, frozen-time cross-pack source-language preservation, clear tombstones, atomic rollback, team scope, actual HTTP 403/409/422 and unchanged original instructions/file digests.
- Web: 33/33, including frozen organization/session sequence, cancellation after each request, explicit update, retries, administrator-only controls existing official-role regressions, and precise proxy routes in same-origin/prefixed modes.
- UI wiring: 137 routes consistent. Browser spec remains reachable through the existing unconditional CI project.

The API/web image source stages include the authored JSON asset and API runtime checks its readability. No image build, deployment or production verification is claimed here. The first browser run passed the editor case but caught missing Next proxy routes on the new update surface. Both exact routes were added after a two-mode red regression; frontend admin pages remain outside the proxy. The second clean production browser run passed both cases: editor/clear/member switch (13.1s), and existing-organization explicit update with preserved manual copy/execution snapshots (11.7s). Total 4m12s including stack cleanup. Screenshots were visually inspected. `./init.sh` quick path also exited 0. Independent review found no actionable P1/P2 in the source and the subsequent precise proxy fix; final exact-commit confirmation follows. GitHub CI and coordinator-controlled merge remain required.

Normal pre-push subsequently caught a missing standard guarded-read doorway in the three new repositories. The callback authorization was retained and routed through actual `guard`/`discloseDecided` control flow; no permission lint exemption was added. Full API lint and a new isolated 21/21 PG/HTTP run pass after that delta. Independent delta review found no actionable issue and confirmed guards determine filtering, rollback and payload access. The archived production browser run precedes this server-only guard wiring; GitHub CI must validate the final head.
