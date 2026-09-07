# Current sources bound to cached sandbox access

The document service already rechecked source authorization after parsing. That alone did not cover subsequent generic read_file/execute access to `/workspace/parsed-*` or copies. Owner.resolve previously returned the saved input manifest without checking current source permissions or bytes; the existing test even expected a changed underlying source to remain resolvable. The real-PG red test now proves a revoked member could still resolve the session before this fix.

PgNativeSessionOwner.resolve reuses PgNativeRunInputs.read inside its existing authorized transaction. Every originally pinned input must match the current schema-parsed source manifest. Missing source provider with nonempty pinned inputs is refused. There is no new source ACL, derived-file registry, remount or new session. Added unrelated current inputs do not automatically join the old pin.

The Python NativeSessionBindingGuard invokes the existing trusted factory resolver (bounded, no-redirect, dedicated service credentials) before and after each sandbox consumer in NativeSandboxDispatch. It retains only session/package/policy/input identity; it does not retain returned tokens. The initial graph binding is immutable, and any different session/package/policy/input or expiry is refused. Controls are still independently authorized and remain outside the consumer queue.

This conservatively denies all later sandbox consumers when any pinned original is revoked, including unrelated cached files and execute commands. It does not parse shell commands or claim path-only interception can stop copied-file access. It cannot erase data previously disclosed to a model or undo already executed side effects. Graph/process concurrency remains controlled by the existing provider; this graph-local queue is not a distributed lease.

Verification:
- owner-red.txt: actual PG revoked-member resolve wrongly succeeded before the change.
- owner-green.txt: 14 real-PG owner/lifecycle tests passed; added membership/private-owner/changed-bytes/missing-provider rejection and restoration without a second create. Wrapper 2154 exit 0, cleaned, peak 3 connections.
- guard-red.txt: missing new guard acceptance module failed collection before implementation.
- guard-green.txt: 22 passed / 3 explicit real-fixture skips. Sync+async trusted resolver checks, mismatch/expiry/schema denial, queue-before-check, post-execution revoke refusal, cached read/execute denied, and official nested task regression. These Python source-revocation cases use a deterministic resolver fixture; they are not the real-PG test.

Root owns factory/graph final wiring. The production factory must construct NativeSessionBindingGuard(resolved, lambda: _resolve(ref,identity)) and pass it as binding_guard to create_native_graph; the graph passes it to the already-installed NativeSandboxDispatch. S018 unchanged real-model parsing must be rerun after that wiring. No production factory completeness is inferred merely from the isolated guard tests.

## Final integrated evidence

Root's actual native_factory/native_graph integration is now present. `final-python-green.txt` reports **43 passed, no skips**, including actual isolated sessions, production factory resolver transport, graph gate, current-binding guard, and official nested files-readonly tasks. The three known upstream deprecation warnings remain unchanged.

`cache-http-green.txt` reports **7/7 passed** using production createApp/PG/UDS and a real Python native factory graph. The first six cases retain four-format parsing and source permissions. The seventh creates cached PDF Markdown through the actual document service, constructs one Python graph, revokes the source's private ownership in actual PG, and invokes original read_file and execute. Both fail before cached-source commands run. Restoring the original ownership permits both actual reads, whose tool outputs contain the expected PDF value `450`; the session identity remains unchanged. The model is deterministic ScriptedModel, not an external model, and the test does not alter prompts to avoid parallelism.

Two official `/skills/` directory-discovery executions occur before tool middleware on the two failed invokes. Diagnostics verify their base64-decoded directory is `/skills/`, using os.scandir, not read_file or a command accessing the cached document. Thus the assertion is no cached-source command, **not zero total E003 traffic**. The first two failure logs preserve the mistaken aggregate-count/plaintext-path fixture expectations. A third fixture failure omitted trusted config from direct graph.ainvoke; adding the normal invocation config made the unchanged production authority path pass. None of these fixture fixes relaxed production authorization.

Wrapper 14372 exited 0 and cleaned its stack (15 seconds, peak 3 connections); private sandbox binding/session, Python child and UDS relay also closed. DB was handed to the S018 real-model worker. Final Python wrapper 14062 exited 0 and cleaned each private session. No owned resources remain.
