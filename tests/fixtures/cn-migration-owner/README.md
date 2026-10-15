# Migration Linux validation boundary

This fixture adds no production install, policy or service authorization.

| Aggregate | Exact test files | Actual local result | GitHub evidence still needed |
| --- | --- | --- | --- |
| Existing guard | `migration_scope_adapter`, `a_route_factory`, `source_production_consumers` `_test.ts` | 51 passing, names in `guard-cases.json` | Update its old 48 assertion to this exact list and run Linux |
| New terminal | `migration_owner_observer`, `migration_owner_terminal`, `entry`, `source_plan_authority`, `migration_transport` `_test.ts` | 68 passing, names in `terminal-cases.json` | New Linux aggregate |
| New terminal Python portion | `test_cn_release_migration_owner.py`, `test_cn_release_migration_owner_native.py` | 19 passing | Same Linux aggregate |
| Separate owner lifetime primitive | `cn_release_migration_owner_linux.py` | Not run on Mac; Linux/root are required | Real cgroup/FD9 observation and exact outer cleanup |

Run the new aggregate with the workflow's already pinned Node path in
`CN_API_STARTUP_NODE`, using the existing owned Linux containment:

```
python3 -B tests/cn_release_migration_terminal_linux.py
```

It has one 180-second shared budget for Node and Python subprocesses, exact 68 case
names, exact 19 Python count, and rejects missing, skipped, expected-failing or
changed-count evidence. The subprocesses inherit the caller's containment; no new
session is created. A timeout kills/waits the direct child; descendant disposal
remains the existing outer cgroup supervisor's responsibility. Do not invoke it
as an uncontained replacement for that supervisor. The runner may count this as
one aggregate, while reporting its underlying 68 Node and 19 Python cases. The
51 guard cases must not be counted again as part of this aggregate.

The independent owner lifetime primitive must be a separate aggregate under the
same outer containment. It creates only an owned child cgroup, uses a real flock
FD9 and a timed-out finite dispatcher, verifies the owner keeps the lock, then
kills/drains the exact owned outer subtree and verifies the lock is available.
It does not invoke systemd or the installed launcher.

These tests exercise original TS validators and factory code with fixture
operation ports, and the Python native protocol with mocked installed reads and
systemctl. They do not verify a real installed root terminal sink, loaded systemd
unit/drop-ins, launcher-to-Node PID identity, full production backup/migration/UI
execution, or production policy authorization. Those gaps remain open after a
passing aggregate. In particular, a real systemd/launcher test still needs an
isolated Linux systemd environment and approved fixture-only installed closure;
this change neither installs it nor claims GitHub's ordinary job has such a setup.
