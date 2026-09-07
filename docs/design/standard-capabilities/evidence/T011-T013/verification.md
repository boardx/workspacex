# T011–T013 native interaction entry

The native factory now registers the existing three `tools.py` interaction bodies through `build_tools(..., interactions_only=True)`. The default legacy tool list remains unchanged. Native registration does not expose `call_skill`, `list_org_skills` or `spawn_async_task`.

The gateway native profile uses `AGENT_INTERRUPTS_TOOL_NAMES` from the existing shared contract. The factory always strengthens these three interaction policies to true: a missing or false key from an older binding cannot cause a tool to claim human confirmation without its form. Other resolved policies remain unchanged. NativeToolAuthority still checks every actual dispatch.

Evidence:
- registration-red.txt: the real factory construction boundary did not register these names before the change.
- python-green.txt: 53 passed, 1 explicitly skipped real-sandbox fixture. Includes actual official LangGraph checkpoint interruption, fresh graph reconstruction, async edit/reject, sync empty-assumptions approval, and identical underlying function code objects with the legacy tools. The tests use an in-memory checkpointer only as a test fixture, not as production persistence; the factory retains its existing shared runtime checkpointer.
- authority-green.txt: 4 real PG tests passed. For all three names, the existing authority accepts only the edited arguments, actual call ID, permission request and active attempt; original arguments, altered identity, other organization and parent cancellation are denied. Repeated checks on the same authorized attempt remain idempotent. The native provisioner projects all three shared names as mandatory interrupts.

No new form, decision schema, interrupt, UI state or approval database was added. `ConfirmIntentArgs.assumptions` already allows zero entries and is reused unchanged. Existing UI ownership and authentication/decision endpoints remain with the workbench implementation.

Compatibility verified: binding-red.txt reproduces the old binding rejection. The owner now accepts only absent/false → true changes for the three shared interaction names, within the existing authorized transaction and a binding row lock. binding-green.txt reports 6/6 real PG tests, including old missing-key and old false-key bindings; unrelated additions, even unrelated stricter policy, deletion and weakening are rejected. The same session is reused without another create or premature release. All package/input/state/expiry checks remain in force. boundary-green.txt reports 59/59 structural permission tests. Both DB wrappers exited and cleaned all owned resources.
