# Candidate v2 publication sequence

`cn_candidate_publication.py` is an internal sequence for a separately admitted trusted host adapter. It has no command-line production entry, credentials, transport, installation or migration capability. Existing candidate `offline_assembly` remains `NOT_READY`; legacy archive-v1 consumers continue to reject candidate-v2.

The sequence verifies original plan and candidate receipt bytes, all five actual tar archives and their current expiry before calling the adapter. A distinct publication intent binds exact source, control, attempt, original hashes, candidate identity, semantic release and the Shanghai registry Redis digest reference. It never changes candidate labels, tar/config bytes or expiry.

After local collisions and running-target checks, the adapter must authenticate the existing ECS identity and registry session. Every remote target is inspected for collisions. Redis is then pulled and its exact remote digest read back before the first candidate load, tag or push. Candidate pushes are followed by immutable digest and image identity verification; a lost push acknowledgement allows only readback, not an automatic second push. Expiry is checked before mutations and sealing.

The admitted adapter must implement `canonical_publish_candidate(manifest_input, binding)` using the original TypeScript six-image manifest generator, validator and sealer. It must atomically store the real manifest/seal with the binding to candidate plan/set/intent hashes and authenticated Redis observation. This module does not supply that production adapter or claim its implementation is complete.

Required host admission before invocation:

- Root-owned protected plan and current immutable repository provider evidence, binding exact account/ECS/registry, approved scope, binary and installed tool closure hashes.
- A release lock and protected FD-pinned inbox files copied into a private immutable snapshot, with source provenance, original hashes, capacity and deadlines verified before Docker operations.
- Existing role credentials used only inside a temporary Docker configuration; authenticated registry reads and actual Redis platform/RepoDigests verification.
- Full current expiry checks during commands and atomic canonical publication, no preparation/activation fallback.
- Owned-tag-only cleanup; no image-ID deletion or shared cache pruning. Cleanup failure must not mask a primary error or prevent attempts to clean other owned tags. An unconfirmed cleanup rejects an otherwise successful return.

Fourteen local tests use real synthetic tar archives and an isolated fake publication port. They cover byte/hash binding, malformed identity, tar mutation, receipt expiry including mid-run expiry, Redis authentication/digest failure, local and remote collision checks, lost acknowledgements, unchanged archive bytes, six-digest canonical input and cleanup failure handling. These tests do not establish a working production adapter, transport, host installation or actual registry authentication.

## Docker containerd image-store identity

Docker 29 with the containerd image store reports the manifest digest as inspect `Id`; candidate `imageId` remains the original raw config digest. The classic store comparison stays unchanged. A different `Id` is accepted only through the admitted host's bounded, private, read-only `docker image save <immutable-id>` export. The verifier hashes the descriptor's actual manifest bytes, then hashes the referenced raw config bytes to the original candidate config digest. It also checks source/candidate labels, Linux amd64, exact inspect/config RootFS ordering, and every exported layer against the original size and diff-ID. Gzip layers require both the stored compressed digest and an expansion bounded to the exact original layer size and digest. Unsupported compression/index ambiguity rejects.

This does not rewrite inspect data, the daemon store, candidate archive, original identity, approval, or expiry. Export uses the existing approved Docker binary and deadline; stderr remains undisclosed and bounded. The host repeats immutable image inspection afterwards and removes its private export. Only a newly loaded staging tag whose image was successfully verified enters cleanup, with its actual daemon identity; failed/unknown verification leaves that tag for explicit reconciliation rather than deleting an unverified image. No image-ID deletion or shared cache pruning is added.

A real local Docker 29.6.1/containerd-store API candidate test verified the raw descriptor→config and all original layer bytes in 8.217 seconds with no registry access or application launch. Production Docker 29.1.3/containerd-store observation motivated this compatibility path; it is not a production publication or authorization receipt.
