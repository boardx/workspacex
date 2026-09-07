# WX-E004 native capability graph evidence

2026-09-07. This module is opt-in and is not wired into graph_selector, langgraph.json, API or main-run lifecycle. No production runtime selection was changed.

## Trusted factory interface

`create_native_graph(model, *, sandbox: HttpSessionSandbox, pinned_skills, interrupt_on, tools=(), system_prompt=None, checkpointer=None, store=None)` returns the official compiled Deep Agent graph. The factory must create the session using exactly `package_mount_files(pinned_skills)`, with no additional packages, and retain the same immutable session/package binding for checkpoint resume. This module allocates no session/run identity and owns no client teardown, cancellation orchestration, approvals or event writer.

Construction validates full package manifests/digests and reads mounted bytes back before accepting pins. Legacy SKILL.md-only snapshots fail explicitly; trusted factory selection of the existing legacy runtime is the only legacy switch. Package content is not injected wholesale into model messages.

Official `create_deep_agent(backend=..., skills=['/skills/'])` provides the file and execute tools. The same CompositeBackend is passed to the existing harness FilesystemMiddleware via a backward-compatible optional backend argument. Its default is HttpSessionSandbox; `/large_tool_results/` routes to official StateBackend, so eviction does not attempt to write the sandbox's read-only root. CompositeBackend removes the routing prefix internally: `/large_tool_results/large` is presented to tools, while the StateBackend files key is `/large`.

A thin SkillsMiddleware subclass retains its official name for by-name replacement. It only checks a private digest binding (session plus pinned package identities/content digests), then calls official synchronous/asynchronous hooks. It does not implement a parser, loader or skill prompt. First invocation loads normally; cached metadata, including an empty list, requires the matching binding. A changed session/package or legacy unbound cache fails before model execution.

## Unknown execution outcomes

A negative test reproduced three execute requests with different execution IDs when a response was lost and the existing generic retry policy ran. Native graph assembly now wraps only the official ToolRetryMiddleware's public `retry_on` predicate, excluding SandboxTransportError while retaining every other existing setting/predicate. The harness module itself only adds the approved optional backend argument and passes it to FilesystemMiddleware. The regression verifies one execution request and a propagated, sanitized `outcome unknown` error. Lifecycle owners must reconcile this outcome; they must not automatically replay the pending side effect.

## Verification

Installed Python Deep Agents 0.7.6 and the E003 image identified in the adjacent E003 evidence were used. On macOS the host cannot directly connect to a Docker VM Unix socket, so the explicit integration transport uses a fixed trusted `docker exec node -e` HTTP relay. Request JSON travels on stdin. No model command runs on the host, no Docker socket is mounted into the executor, and all actual script execution goes through E003's bubblewrap/BPF isolation.

Setup, from `apps/skill-sandbox`:

```sh
docker compose -f docker-compose.sessions.yml -p wx-e004-review run -d --name wx-e004-review-test --rm skill-sandbox-sessions
```

From the repository root:

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-e004-review-test apps/deep-agent-service/.venv/bin/python -m pytest \
  apps/deep-agent-service/tests/test_native_graph.py \
  apps/deep-agent-service/tests/test_skill_packages.py \
  apps/deep-agent-service/tests/test_harness.py::test_write_todos_present_with_harness_middleware \
  apps/deep-agent-service/tests/test_harness.py::test_evict_threshold_pinned -q --timeout=60
```

Exit 0: **35 passed, 1 warning in 23.05s**. The warning is an existing google.genai Python 3.14 deprecation warning.

Coverage includes full pinned bytes, official native tool registration and shared backend, both cache hooks, empty metadata and missing bindings, cross-session/version checkpoint rejection, exact large-result bytes preserved in StateBackend, unknown-outcome non-replay, and existing harness defaults. The real integration explicitly asserts SkillsMiddleware discovered `example`, then a scripted fake model calls official read_file and execute to run `/skills/example/scripts/report.py`. It downloads `/workspace/report.txt` and asserts exact bytes `PINNED_SCRIPT_EXECUTED`. Reading SKILL.md alone is not counted as execution success. No legacy call_skill or extra skill-specific model graph is used; the existing rubric middleware is retained with a test grader.

Cleanup stops only `wx-e004-review-test` and runs the standalone compose project's `down --volumes`. No DB stack was started. The existing default runtime and peer-owned UI/main-run command/event/approval surfaces were not modified.


## Explicit delegation and approval boundary

In the pinned upstream 0.7.6 source, `subagents=[]` still auto-adds a general-purpose agent that inherits parent tools/backend/skills. This implementation instead supplies an explicit official `CompiledSubAgent` named `general-purpose`, with `runnable=create_agent(model, tools=[])` and a text-only description/system prompt. The name prevents the automatic default from being added. The precompiled runnable has no tool node, SkillsMiddleware, FilesystemMiddleware or parent custom tools. An actual task invocation test has the child attempt a parent-only tool and verifies zero parent tool executions. No global harness profile, required-middleware replacement or model proxy is used. This is the explicitly authorized minimal text-only T010 increment, not unrestricted delegation.

`interrupt_on` is a mandatory trusted-factory argument; omission and None fail. An explicit empty dict grants isolated low-risk tools; policy provenance/tenant authorization is the caller's responsibility. The graph directly passes the policy to official HITL. The real `execute` test with `{'execute': True}` observes a LangGraph interrupt and no output file before approval, then sends official `Command(resume={'decisions': [{'type': 'approve'}]})` and verifies the expected file exists. No separate approval state machine or UI was introduced.

Raw final output: [native-tests.txt](./native-tests.txt). The common integration helper is `apps/deep-agent-service/tests/native_sandbox_fixture.py`: `with real_native_session(pins=None) as (adapter, pins)` creates/deletes a single session against the explicitly named container and is shared with peer file-tool tests. Its default pins are available as `pinned_skill_package()`.
