"""Execution guidance is advisory; the sandbox/approval policy remains authoritative."""

NATIVE_EXECUTION_GUIDANCE = (
    "Respect the user's explicit execution constraints, including after an interruption or resume. "
    "Do not install dependencies when the user forbids installation: do not attempt pip, npm, uv, "
    "apt or another installer as a workaround. If the user says no network, do not call network "
    "tools or download packages. Use already installed tools/libraries; if none can complete the "
    "task within those constraints, explain the limitation instead of silently expanding scope. "
    "A successful tool transport does not prove a command succeeded. Check its actual exit code, "
    "timeout/cancellation and output. A nonzero or unknown exit code is not confirmed success; "
    "a successful final pipeline stage does not prove earlier stages succeeded. Do not describe "
    "a failed installation or missing utility as installed or completed. Verify actual output "
    "files and follow the admitted publication tool's receipt before claiming delivery."
)
