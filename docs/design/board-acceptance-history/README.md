# Board Acceptance Source History

Refs #5001. Archived on 2026-10-02 (Asia/Shanghai) from the preserved, uncommitted
`codex/board-input-ux-round1` checkout. This PR preserves inspectable source and design
history only. It does not publish runtime results, close feature issues, alter signoff,
or claim browser acceptance/CI-green delivery.

## Scope

The 14 legacy files in `scripts/local-session/` retain their original assertions,
fixtures and explicit coverage gaps. Only a legacy warning and the Connector historical
standard reference are changed. Do not run them against production or treat their existing
PASS strings as evidence. Fresh authorized local sessions, owned temporary boards,
appropriate database migrations and the corresponding feature implementation are required.

The scripts are not self-contained on the Nav parent alone:
Sticky layout/font helpers require Round06; image/files/sync/tools require their own rounds.
`board-object-toolbar-acceptance.mjs` also hashes the Round02 matrix source. Apply
appropriate candidate dependencies before execution; no production sources or another
PR's Connector runners were copied merely to satisfy these references.

## Current Delivery References

Published Draft scopes, not evidence of acceptance or merge:
initial #4965; Round01 #4993; Round02 #4998; Round03 #5002; Round04 #5005;
Round05 #5003; Round06 #5000; Round07 #5004; Round08 #5007; Round09 #5006.
Round10 remains separately owned. Current issue decisions supersede historical documents.
Optional multipart `fileName` was human-approved on 2026-10-02 in #4861;
older unapproved-decision text is history, not current guidance.

## Verification Boundary

Only source syntax, local helper dependency inspection, secret-pattern inspection and the
pure Sticky cancellation classifier are checked here. No browser suite, server, Docker,
file upload, SQL mutation or native-device check was executed for this archive PR.
Current Nav/Round02 attested runners are the source-bound route, not this archive.

No storage-state, credentials, runtime manifest, raw logs, downloaded payloads or private
screenshots are committed. Scripts may read explicitly supplied local credentials or
generate private evidence; this is not authorization to publish that output.

## Historical Documents

- [connector-matrix-authority-plan.md](connector-matrix-authority-plan.md)
- [connector-figjam-acceptance.md](connector-figjam-acceptance.md)
- [sticky-mural-review.md](sticky-mural-review.md)
- [sticky-mural-contract-audit.md](sticky-mural-contract-audit.md)
- [sticky-mural-canvas-plan.md](sticky-mural-canvas-plan.md)
- [connector-figjam-geometry-plan.md](connector-figjam-geometry-plan.md)
- [connector-figjam-ui-plan.md](connector-figjam-ui-plan.md)
- [sticky-mural-acceptance.md](sticky-mural-acceptance.md)
- [connector-remaining-delivery-queue.md](connector-remaining-delivery-queue.md)
- [connector-figjam-contract-audit.md](connector-figjam-contract-audit.md)
- [board-delivery-boundaries.md](board-delivery-boundaries.md)
- [connector-figjam-review.md](connector-figjam-review.md)
- [connector-matrix-acceptance-plan.md](connector-matrix-acceptance-plan.md)
- [sticky-mural-research-plan.md](sticky-mural-research-plan.md)
- [sticky-mural-gesture-plan.md](sticky-mural-gesture-plan.md)
- [connector-figjam-gesture-plan.md](connector-figjam-gesture-plan.md)
- [connector-figjam-execution-plan.md](connector-figjam-execution-plan.md)
- [sticky-mural-ui-plan.md](sticky-mural-ui-plan.md)
- [board-input-ux-round1-backlog.md](board-input-ux-round1-backlog.md)

These snapshots are not phase feature authority. Temporary paths, old PR inventories,
source freezes and historical test totals are not live facts. Original checkout untouched.
