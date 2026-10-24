# Production host read-only inspection — 2026-10-24

Used the user's already connected Aliyun Workbench root Shell. Confirmed `uid=0`,
hostname `workspacex-cn-prod`, and instance `i-uf6ga92ewloganobbln6` before inspecting.
No production files, refs, containers, ingress, sudoers, or secrets were changed.
Screenshots were observed in memory only; terminal session identifiers were not
saved as evidence. No private key or secret contents were read into the output.

- Production repository HEAD: `ba6343199f3c834d6a198f83d0c771614292c82b`, clean.
- Four app containers were running. All four revision labels instead identify
  `f0eb9d07398a66fdd5646a9e6b855fa1b940e571`. Labels alone are not accepted runtime
  identity, health, database compatibility, or browser evidence. The difference
  from the checkout/ref must be reconciled before freezing a runtime baseline.
- Root source cache main: `5285bef9a6c91bbb9857ede42779aafa64b98f32`.
- Runner source cache main: `e30f91ee5c44c2f8698da4d3cf40bb7260f18290`.
- Both cache main-cn refs: `ba6343199f3c834d6a198f83d0c771614292c82b`.
- Existing deploy/build entrypoints: root-owned mode 0700. Existing export and
  promotion verifier: root-owned mode 0755. The runner's direct cmp/executable
  checks cannot read the mode-0700 entries. Updating code alone is insufficient.
- Node 22.23.2; Compose 2.40.3; process-scoped offline Corepack pnpm 9.15.0 works.
  Global pnpm is 12.4.1 and was not changed. Root disk: 197G, 43G available (78%).
- Stable-secret directory exists; no values were printed or changed.
- Maintenance hold JSON reports `cleared`; no hold operation was invoked.
- For candidate `aebd25885b0d44f39c5a2770bf21d42f111fdd64`, preparation JSON,
  candidate-config directory and preflight directory are absent.

Independent code inspection found no generic producer for
`/etc/workspacex-cn/preparations/<SHA>.json`. The existing collector performs live
probes but depends on trusted inputs and complete source already installed. A
one-off root cache update cannot establish unattended deployment for future SHA
updates. Preserve that distinction when reporting automatic-trigger readiness.
