# Deep Agents grep compatibility boundary

The installed `deepagents==0.7.6` upstream `deepagents.backends.sandbox._GREP_PATH_GLOB_TEMPLATE` embeds Python in a double-quoted shell argument. Two double-quoted phrases in its comments split that argument: `"exactly at the cap"` and `"capped early"`. Path-containing globs such as `**/*.txt` select this template. Ordinary basename globs use the separate upstream GNU grep path.

`HttpSessionSandbox.__init__` explicitly calls `ensure_sandbox_compat`. This validates the exact distribution version and the complete UTF-8 template SHA-256, then removes only those four comment quotation characters. It does not replace `BaseSandbox.grep`, `agrep`, `_build_grep_cmd`, the result parser, or user execute commands. The constant is module-scoped upstream, so this exact repaired template is subsequently shared by other BaseSandbox instances in the same process; initialization is locked and idempotent.

- Reviewed version: `0.7.6`.
- Original whole-template SHA-256: `4258343b027087e4f90aa3db83dd3218c063d7eb666c83b9a995d25a8aeb31d1`.
- Repaired whole-template SHA-256: `8206dc7d3e708e4af074e7e917ae35174d938393f3cc76952f913c6d892d9bcb`.

An unknown version or template refuses adapter initialization with a dependency-review instruction. Upgrading the package requires reviewing this compatibility gate explicitly. Delete the hook and compatibility module when a pinned upstream release fixes shell quoting; first run both sync/async real sandbox path-glob, literal matching and truncation regressions against that release. Do not merely widen the accepted version range or hash.

`tests/test_upstream_compat.py` verifies exact two-comment-only change, idempotence, unknown source refusal, unchanged upstream function identities, byte-for-byte user command transmission, and original-vs-repaired shell tokenization/Python compilation. Its opt-in real sandbox tests use `WX_NATIVE_SANDBOX_CONTAINER` and the shared trusted fixture. Actual integration result is recorded separately; unit verification alone does not establish execution success.

Real synchronous/asynchronous path-glob and cap tests now pass, together with the T006 file-tool assertion: 3 passed in 12.71s. Raw output and the initial failure history are in ../WX-T001-T008/. The eight-file Python regression also passed 173 tests with four explicit real-container tests skipped (subsequently exercised in the live run); raw output is ../WX-E007/native-regression.txt.
