# Exact candidate acquisition: disposable GitHub unit

Run 38261015860 confirmed that the original child Domain had no memory.max,
memory.swap.max, pids.max or cpu.max files. This is not evidence of unlimited
effective resources; its ancestors may impose limits. No image load began.

The new acquisition helper uses one UUID-named transient **service**, launched
with systemd-run --pipe --wait, Type=exec, no restart and no --collect. Its own
unit has MemoryMax=3 GiB, MemorySwapMax=0, TasksMax=128, CPUQuota=200% with a
100 ms period, RuntimeMaxSec=2100, and a 15 second stop timeout. Core dumps are
disabled. The root supervisor stays in its original cgroup. No existing parent,
sibling, subtree_control, global service configuration or machine size changes.

Before Start, a root-private exact-control checkout and an exclusive durable
claim identify the fixed bridge. The bridge writes an atomic private ready
receipt, then blocks on bounded stdin. The supervisor verifies the real unit's
ExecStart, MainPID command line/start ticks, InvocationID, exact ControlGroup and
inode, configured properties and the four unit-level kernel limits. Ancestor
limits are recorded without modification. Only then is a single bounded token
frame sent through stdin. No token enters systemd arguments, Environment, files,
stdout, stderr or journal. The bridge rechecks identity/limits before using it.

The original Domain then provides descendant containment beneath that verified
unit. It does not need its own resource-controller files and does not enable
controllers. The original acquisition worker retains bounded byte verification
and idle-daemon loading. Non-GitHub child commands continue to receive no token.
Preparation/handshake time counts toward the supervisor's 2100-second budget.

Unknown Start acknowledgement never causes another Start. Cleanup requires the
same observed InvocationID and cgroup inode. A durable stop claim precedes the
one stop request. A known unit's observed disappearance or verified inactive
state plus removed cgroup permits exact loaded-tag cleanup. Unproven ownership,
missing acknowledgement or failed cleanup keeps the result unknown and the
private claims intact. No process-name scan or global Docker cleanup is used.

Local validation: 18 existing acquisition tests and 12 new unit tests pass.
These are protocol/real local pipe/file tests, **not a systemd integration test**.
Actual GitHub unit properties, effective containment, token handshake and stop
semantics remain unverified. Missing properties/controllers reject; there is no
fallback to weaker limits. The accepted 17-file application runtime is unchanged
and remains unwired by this acquisition-only change.

Primary references: [systemd-run](https://www.freedesktop.org/software/systemd/man/systemd-run.html),
[resource controls](https://www.freedesktop.org/software/systemd/man/systemd.resource-control.html),
[service lifetime](https://www.freedesktop.org/software/systemd/man/systemd.service.html).
