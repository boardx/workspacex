# CN Chat command outcomes — #6322

## Failure and change

The original `/bin/sh -c` pipeline returned zero when an earlier installation command failed but `tail` succeeded. Session execution now uses Bash with `pipefail`, without loading profiles or adding `errexit`. The readiness probe uses the same shell and binds its executable directory. The image explicitly installs Bash. Existing isolation flags remain in force.

DeepAgents 0.7.6 reports transport success through ToolMessage.status even when execute failed. For execute only, the API now requires the structured artifact.exit_code to be integer zero. Nonzero, missing, or unknown exit metadata cannot produce a successful tool event. Other tools retain their existing transport semantics; stdout is never parsed as a success signal.

Native graph construction includes guidance to respect user prohibitions on dependency installation and network calls, including after resume, and to inspect command outcomes and artifact publication receipts. This guidance is advisory: these tests do not prove that a real model always obeys those restrictions and do not introduce a new deterministic permission policy.

## Evidence

- Before changes: shell test reproduced the masked nonzero exit; three HTTP-wire execute cases incorrectly reported success; four graph-construction cases lacked the guidance.
- Sandbox session command/manager/input suites: 17 passed, including an actual Bash pipeline, successful pipeline, and explicit recovery without errexit.
- Isolated API command-outcome and deep-agent-stream suites: 20 passed, including real local HTTP responses with exit 0, 7, 127 and unknown, all with transport status success.
- Offline Python native factory and sandbox backend suites: 58 passed, 1 skipped. The existing skipped E003 case requires an explicitly owned integration container; it is not counted as passing.
- API and sandbox typecheck plus API lint: passed (exit 0).

## Boundaries

Host Bash subprocesses are not proof of Linux bubblewrap execution. Local HTTP fixtures are not paid real-model tests. CN production has not been released or retested by this change. Preserve the original failed command and the independently successful PDF recovery as separate evidence; meeting output and image publication are not inferred from these tests.
