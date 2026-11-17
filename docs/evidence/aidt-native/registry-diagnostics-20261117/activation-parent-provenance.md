# Configuration-activation parent provenance

Independent recheck: 2026-11-17T06:52:13.473731+00:00. This review only re-read saved original evidence and copied the aggregate manifest; it did not start a workflow, access the registry, derive/publish images, deploy, change host configuration, or invoke models.

## Immutable parent

The proposed parent is the **complete** successful [build 44015992148, attempt 1](https://github.com/boardx/workspacex/actions/runs/44015992148). Its five build jobs and aggregate manifest succeeded; deployment was skipped. Created 2026-11-17T04:16:08Z; completed/updated 04:22:23Z. Control source was `34978afd8fdb24a0d1cc4ff2ad9054335e39774b`; application source was `27b305e607281e54b4cf905269e30e26a35bee9e`. The parent tag is `44015992148-90000000000000000001`, platform `linux/amd64`.

`activation-parent-release.json` is an unchanged byte copy of the original extracted `/tmp/aidt-build-44015992148-verified/release.json`: **2329 bytes**, SHA256 **`e2422ce0260fa39101bd5464e975baadd4992e3e7991e4c83801faba7fc3412b`**. This is the raw JSON hash, distinct from its ZIP archive hash.

All six retained original ZIP files were rehashed against the previously retrieved GitHub artifact metadata. Each contains exactly its expected entry; each extracted entry was rehashed. The five per-role JSON receipts equal the corresponding aggregate `images` objects exactly, and equal their saved original bytes. All five role/source/tag bindings match the complete parent.

| Artifact ID | Artifact | ZIP SHA256 |
| --- | --- | --- |
| 14299680513 | `release-manifest-44015992148-1` | `9c29e68dfa7b1ecb39ff2ccff33927d48f1d5a69ba51539ce2e4d1e7d8e9e23d` |
| 14299205684 | `release-image-44015992148-1-postgres` | `4986eb13ccab8e79d0a07d258125fee52d94f87f6ef1e3ff473ac85f98226e77` |
| 14299106240 | `release-image-44015992148-1-agent` | `e7edb0222a2c141b9ad296dbf2397999b94c9eda31b2e5fcd2d92def9efdd062` |
| 14298767650 | `release-image-44015992148-1-api` | `4f32632541555f06dcb02a3495aad94ed1ad41cc3e1e317c4fec82d54475eb56` |
| 14298599275 | `release-image-44015992148-1-web` | `45881c72d481a6c58b93d9f045814b5cbab254e985e965690c9e4b29e30b72a7` |
| 14298393453 | `release-image-44015992148-1-sandbox` | `176d6574d2752b95c19c71679ea1a0da6f639a690e7520bcc3e2fb972f69ec72` |

| Parent role | Immutable registry manifest digest | Config/image ID |
| --- | --- | --- |
| postgres | `sha256:5e6c9aae363ffec6dbce6d279537b0c21f4e7ec10919a2c81756dc49881f782f` | `sha256:b2478116994bea553a3be1d374654c8cdbbc2b68ee8736c9d2307ee01d198ca2` |
| api | `sha256:7332426f6120be8f7c6b88f511260071ba8f8d943aad8f9ddb028b72970209cc` | `sha256:0b80c19eab84d1486d55159b6d3e84244b373abfe82db2d5943c39971bc23c14` |
| web | `sha256:e6d25d3577c4fafddf307e25582bc7c3dd250cd8a11fcec9bc2790e4b7f10e47` | `sha256:8fcc6b19f0fd4efedcc66d13324f9f9390b86e7b86b10e824155a1a28346122c` |
| sandbox | `sha256:64f18d7646e24eacb0c22ab9df8d618dd6ca9d5de7728f29fb50d02e33d406c5` | `sha256:ec12c88a7a69a518ec5989ad13ce01ad71bcd15bbbf6b86ccf4faeacc9ce1630` |
| agent | `sha256:dec669cbf6d77a3cf4cae774aaed83df07a638a89027bee6d56bf9064558ab27` | `sha256:13dffa18a25d465dec462ef334d2b2823a251d0fe35f963ac268b25b4fbb1c4f` |

## Existing deployment and bounded runtime evidence

The native [release 44017242161](https://github.com/boardx/workspacex/actions/runs/44017242161) reused this exact parent tag from develop control `162e48a860d38783b26af627f65a9ea0db7bead0`. Its actual native record at 04:31:44Z was `SUCCEEDED`, `stage=complete`, `database=COMPLETE`, environment `devapp` and the exact parent tag. That bounded native record did not itself contain per-image IDs or migration ledger/checksums.

The later read-only [exact-release probe 44020255177](https://github.com/boardx/workspacex/actions/runs/44020255177) observed api/web/agent/sandbox and optional sandbox-sessions carrying the parent source and tag. Its returned image identity fields equal the corresponding parent **registry manifest digests** for all five observed application entries; they do not equal the separate config/image IDs. PostgreSQL is a complete-build parity item and this application release/probe did not assert replacement of the running database container. The existing safe projection and comparison are `/tmp/aidt-exact-runtime-44020255177-safe.json`; this review re-read it and did not perform a new host probe.

That probe observed both API module keys unset in Docker Config.Env. Existing source review establishes NODE_ENV=production skips the development env-file loader. A later [authenticated read-only run 44028505612](https://github.com/boardx/workspacex/actions/runs/44028505612), safe projection at **06:08:03.0925138Z**, actually logged in (HTTP 200), saw `/aidt` and same-session re-entry (HTTP 200), but own-account courses returned `AIDT_COURSE_NOT_FOUND`/404 and a never-created member probe returned `MODULE_DISABLED`/404. It made no business mutations or model requests. This is an actual failed gate check, not successful course/member acceptance.

These are timestamped observations of the deployed parent. They do not prove uninterrupted runtime state after those observations; this review issued no fresh network/host check and makes no continuous-current-state claim. The failed source001 build below performed no deployment, so it supplies no evidence that the parent was replaced.

## Exclusion of partial newer builds and future derivation limits

The source001 build `44026532271` used a different application source `00120c5ff4d276ae01ac6b1ce91464fe4fb46af9` and tag `44026532271-90000000000000000001`. API and sandbox reached `BUILD_TIMEOUT_API`/`BUILD_TIMEOUT_SANDBOX`; only web/agent/postgres receipts completed. Its manifest and deployment jobs were skipped. **None of those partial receipts, images, source fields or digests is included in this parent file.**

A separate configuration-only derivation can honestly retain application-code source27b only if it demonstrably starts each role from its exact immutable parent digest and changes only the declared image configuration/labels. It must identify itself as a derivation, not a source001 rebuild. API ENV defaults1/1 and any new release-tag labels change image configuration and generally change config/manifest digests; old IDs must never be copied as new output IDs. A future complete set requires all five fresh same-attempt receipts, actual immutable output readback, exact source/new-tag checks, API defaults verification, and aggregate equality before native deployment. This parent evidence alone proves none of those future results and does not override explicit runtime environment values.

The earlier Dockerfile-build path remains distinct: passing new build arguments while checking out old source27b does not activate its old Dockerfile and must still fail its enabled API expectation. No claim is made here that a derivation implementation, new image, new tag, runtime activation, classroom collaboration or model acceptance already exists.
