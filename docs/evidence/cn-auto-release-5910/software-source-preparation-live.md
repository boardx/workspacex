# One-time software source preparation — live CN evidence

This is tooling preparation on the existing CN ECS, not a release or database
rehearsal. Trusted entrypoints, host policy, production repository/caches/refs,
Compose pointers, stable12 and application databases were not modified.

Public Git metadata returned main
`d1096e3003e35d9eb0a9a446b8a0b0594d32ae3a`, exit0. A new root-private mirror
was downloaded at `/var/lib/workspacex-cn/auto-tools-source-staging-5913/source.git`.
The download had a600-second timeout and private log under the canonical release
lock, without replacing its inode. Full strict fsck returned0; shallow=false,
no partial/promisor configuration and no object alternates were checked.
This isolated mirror is not either production cache or the running repository.

The exact reviewed software commit
`a10afa5f5d876a3b6d66585ba72e0d4c7d1b3958` was fetched into that isolated mirror,
then exported as a self-contained bundle, no prerequisite header. Actual bundle:

- `/var/lib/workspacex-cn/auto-tools-source-staging-5913/tools-review-a10.bundle`
- 629312048 bytes
- SHA256 `0fc1244be5d0276d53ac52613572d7b8da3dbe1f1ef15bd369ef454b4d74d687`

Git bundle verify reported complete history. Default clone did not fetch its
custom `refs/review/` ref, so the first explicit checkout failed rather than
claiming source ready. An explicit fetch of that exact ref from the same local
bundle fixed the import. The standalone `reviewed-checkout` now has exact HEAD,
clean Git state and full strict fsck exit0. No production source admission used
this one-time tooling path; the automatic release retains its Actions-produced
complete source artifact and fixed importer.

The first frozen offline dependency install stopped honestly with
`ERR_PNPM_NO_OFFLINE_TARBALL` (@napi-rs/image1.1.5). A separate preparation operation
prefetched the frozen lock closure from `https://registry.npmjs.org`, with scripts
and pnpm hooks disabled, 600-second deadline, two network requests at a time,
10GiB disk reserve and bounded log. It completed0. Generated staging node_modules
was removed, then pnpm9.15.0 installed offline with frozen lockfile, ignore-scripts,
ignore-pnpmfile and package-import-method=copy: exit0, lock unchanged. No global
pnpm update or credential copy was performed.

The installed root node_modules audit checked137486 ordinary single-link files
and5829 internal links: root ownership, no group/other writes, no link escaping
the protected checkout. Host Node loaded tsx successfully. This is a root-private
staging checkout; the final main software binding and policy are still pending.

Actual Linux browser probe used the previously inspected tools image
`sha256:657a159054f1a890176d8c3476c09e9e4bebc0254a8b6f93a482aa7cb9a04f8e`,
readonly tool mount/rootfs, network none,512MiB/.3CPU/pids512,256MiB shm and tmpfs,
cap-drop ALL and no-new-privileges. Initial canonical `--preflight` failed.
The separate credential-free startup diagnostic confirmed Playwright reached
Chromium launch, then crashpad failed with `--database is required` in the
readonly default HOME. Changing only container HOME to `/tmp` made the original
canonical `cn-release-browser-smoke.mjs --preflight` pass with its exact expected
output, exit0. Keep `-e HOME=/tmp` for this readonly tooling probe; do not remove
readonly/network isolation to make it green. This about:blank check is not login,
notifications, migration compatibility or public production browser acceptance.
All named probe containers were absent after cleanup.

Actual canonical maintenance read returned state=cleared. Existing hold.lock and
hold.json are root600 ordinary single-link files. The installed maintenance
helper is root700 and matches its existing trusted-tool-binding hash. Production
health returned200 after tooling checks. No source cache, accepted ref, trusted
entry, policy, production credential or service update is established here.
