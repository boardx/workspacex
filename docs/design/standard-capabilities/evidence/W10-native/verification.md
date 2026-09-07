# W10 native composition and persistent tool snapshot

The gateway profile includes the five canonical names from STANDARD_BROWSER_TOOLS. Navigate/click/fill are L2; snapshot is L0; screenshot is L1 because it only writes a reversible image into the bound workspace. Publication remains a separate artifact action.

The factory registers the cloud-provided browser tools by their real schema and implementation. StandardBrowserError is excluded from the existing official ToolRetryMiddleware predicate; no browser transport or permission implementation was replaced.

Compatibility uses the existing binding interrupt_on map as the persisted capability/policy snapshot, not a second catalog. New bindings store the current policy. An existing binding ignores candidate-only new keys, retains its old tool set, and refuses changed/deleted old policies. The previously reviewed three human-interaction keys may only strengthen to true; no other tool key is added to an old binding.

The trusted factory passes its frozen policy key set to NativeToolSnapshot. Custom tools are filtered before graph construction. The thin official AgentMiddleware filters model-visible tools (including automatic filesystem/task tools); its authority wrapper rejects outside-snapshot actual calls before invoking the existing HttpNativeToolAuthority. The same authority reaches file delegation. Unknown persisted names fail graph construction rather than silently gaining a fallback. Official filesystem implementations and their identity checks remain unchanged.

Evidence:
- browser-red.txt: factory omitted browser tools and unknown browser outcomes lacked native retry exclusion.
- snapshot-red.txt: the old graph had no snapshot enforcement entry.
- owner-red.txt: real existing bindings rejected a candidate containing new browser names.
- owner-green.txt: 4 tests passed using real PG for old binding preservation and the trusted native provisioning/risk policy path. Both missing/false historical interaction maps remain compatible; candidate-only keys are absent after resolve and session create remains once. Old-policy removal/changes still fail.
- python-green.txt: 57 passed, 3 explicitly skipped real sandbox fixture tests. Covers real native factory registration against trusted snapshots, original cloud function/schema identity, actual official graph dispatch (outside-snapshot automatic tools refused), model visibility, unknown persisted names refused, unknown browser action invoked only once, and interaction checkpoint regression.
- guard-green.txt: existing workbench structural permission suite passes (59 tests).

These tests use fake browser transport/model and do not claim a real Chromium network or receipt validation. Those remain the cloud-owned adapter/deployment evidence. No cloud browser adapter file was edited. The standard DB wrapper exited 0 and removed its resources (6 seconds, peak 3 connections). No owned DB or sandbox remains.
