# Official file tools: behavioral verification increment

2026-09-07. These are the installed Deep Agents 0.7.6 BaseSandbox operations, inherited by HttpSessionSandbox. No duplicate file/search/delete implementations were written. The test asserts method identity as well as observable behavior. Only execute/upload/download are the existing E003 adapter primitives.

| ID | Real sandbox behavior verified |
| --- | --- |
| WX-T001 | Chinese/space filenames, missing directory error, sibling session cannot read a file |
| WX-T002 | Exact line window/pagination and hidden control socket path |
| WX-T003 | UTF-8 roundtrip hash and immutable Skill bytes |
| WX-T004 | Ambiguous/missing edits leave bytes unchanged; unique replacement changes exactly once |
| WX-T005 | Recursive Unicode filename glob and parent traversal rejection |
| WX-T006 | Literal match, exact source line numbers, explicit truncation, no-match; sync/async path glob |
| WX-T007 | Delete workspace file; Skill delete denied and original bytes remain readable |
| WX-T008 | Actual Python calculation writes 5050; nonzero process exit stays 7 |

## Execution and failure-driven fixes

The first real run passed five tests and exposed two test shape mistakes and one actual upstream defect. Upstream read returns a text string, and glob returns paths relative to its search root; assertions now match the actual API. Path-glob grep failed with Python SyntaxError because two comments in the upstream shell template contained bare quotation characters. The exact source/hash guarded fix is documented in ../WX-E004/upstream-grep-compat.md. It retains the upstream implementation.

Repeated execution subsequently exposed 108 orphaned bwrap zombies under node PID 1, exhausting the existing 128 PID limit. WX-E003 now enables a container init; its separate 160-execution test demonstrates zero accumulated zombies. No resource limit or isolation policy was relaxed.

After that fix, the explicit live combined command was:

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-native-files-test .venv/bin/python -m pytest \
  tests/test_native_graph.py tests/test_skill_packages.py \
  tests/test_upstream_compat.py tests/test_native_file_tools.py -q
```

This run produced **46 passed / 3 failed** with no skipped integration tests. The remaining three failures were solely test assertions using `line_number` instead of upstream GrepMatch's actual `line` field. After correcting those assertions, the targeted command below exited 0 with **3 passed in 12.71s**:

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-native-files-test .venv/bin/python -m pytest \
  tests/test_upstream_compat.py::test_real_upstream_path_glob_grep_and_cap \
  tests/test_native_file_tools.py::test_t006_literal_grep_and_explicit_cap -q
```

Thus all 49 cases have passing evidence across those runs; this is not a claim that one combined run returned 49 passed. Raw outputs retain the original failure and corrected result. One existing Google SDK deprecation warning remains.

The named test container and its wx-native-files volume were removed after verification. No production model, gateway selection, event writer or external storage was exercised. Standard-ID public trace mapping, attachment original access, multimodal image read, production factory, artifact publication, and peer UI/controls remain integration acceptance work; this evidence does not mark all eight capabilities passing.
