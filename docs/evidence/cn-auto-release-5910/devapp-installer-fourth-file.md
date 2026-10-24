# Devapp trusted installer completeness

The installation workflow independently checked only three targets, although
the current installer source installs four. A host with an older three-file
installer could report a green installation while the required runtime identity
module remained absent or stale. Source text alone cannot establish the actual
host's installer version.

The workflow now checks all four fixed files against its checked-out main Git
blobs, with actual root:root ownership, exact0755/0644 modes, ordinary nonsymlink
type and single link. A missing/unsafe/stale fourth file returns explicit
DEVAPP_TRUSTED_SCRIPTS_NOT_READY. No privileged command, sudo rule, self-update
or root write capability was added. The same existing no-argument installer
remains the sole installation command.

Actual extracted-workflow regressions reproduce the old false success and
require failure for missing/stale/incorrect-owner/mode/symlink fourth targets,
while all four correct targets pass. Parent25/25 and independent49/49 related
tests passed. Metadata is shimmed only inside unprivileged fixture execution;
these tests do not establish actual remote ownership or installation success.

If a real run finds the old three-file installer, redispatch cannot update that
installer itself. A reviewed once-only update through an existing Devapp root
operations entrance is then required. Do not rerun full provision or add a
runner-controlled sudo path. The host's version has not yet been observed.
