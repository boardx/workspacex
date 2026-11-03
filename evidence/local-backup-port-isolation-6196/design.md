# Fixture port and lifecycle correction — #6196

The test assumed55490–55493 were available. Its third listener collided in a merge candidate; no runner owner snapshot exists. Binding a temporary probe then closing it would still allow a concurrent claimant. The chosen correction requests port0 directly from the real PGlite socket server and reports its published bound port, so the OS chooses and owns the listener in one step. Fixed configured ports keep their existing fail-fast guard.

The roundtrip test uses one helper that owns each real PGlite handle. A nested client-finally closes pg connections, and an independent outer finally closes only that handle even if connect or end fails. No process scanning or port killing is introduced. The extra no-op database reopen is removed; actual data creation, backup reopen and restored-directory reads remain real. Existing backup integrity and exact row-count assertions remain unchanged.

Controlled baseline: free historical ports passes. An owned sentinel on55492 deterministically produces the reported failure in unmodified develop; the sentinel remains owned and alive. The repaired real roundtrip succeeds under that same sentinel. Failure injection covers connect/end/callback paths with real owned PGlite listeners; a separate fixed-port guard test confirms an unrelated server's response survives rejected startup.
