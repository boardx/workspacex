# PR #3229 gate repairs

Base 328e63ceb7c14a29c6e644453a3d0a191fa5ea71. The unavailable native continuation test now requires the new runtime_unavailable reason alongside MODEL_CALL_FAILED. It still forbids fallback provider execution.

Attachment notice formatting is moved byte-for-byte into attachment-notice.ts. execute-run imports and re-exports the same public function, preserving callers while removing a separate formatting responsibility. The thin gateway line threshold is unchanged.

Validation: isolated init passed; the standard with-test-isolation entry ran continuation, thin gateway and attachment notice tests: 3 files / 16 tests passed. Scoped cleanup completed. git diff --check passed.

API tsc remains red on existing fabric-markdown DOM/canvas types. Restoring the parent execute-run.ts and rerunning tsc produced byte-identical diagnostics (saved output), confirming no new diagnostics from this extraction. This is not a claim of full typecheck success.
