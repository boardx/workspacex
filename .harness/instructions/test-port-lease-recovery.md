# Recovering quarantined test port leases (#3128)

Owning wrappers publish `starting: true` before releasing listeners or starting a
command. Normal child exit and successful scoped Docker teardown release leases.
Signals, nonzero or signal-terminated children, spawn errors, failed Docker
teardown and deliberately retained stacks keep the quarantine even if Docker
cleanup succeeds. A launcher exiting after a signal does not prove its descendant
exited. Only an unsignalled zero exit with successful scoped teardown releases
leases; this assumes a normally successful command honors its descendant lifecycle
contract and is not a general process-tree termination guarantee.
SIGKILL, OOM, or `process.exit()` without completed teardown also retain it.
A dead wrapper PID does **not** establish that its child or descendants are gone;
these ports are never automatically reclaimed, even after the known child exits.
Incomplete/corrupt publication also remains unavailable. This trades bounded port
availability for startup isolation; enough quarantines can exhaust a port band.

Recovery is explicit operator work, not a PID sweep or an automatic cleanup timer:

1. Find the exact port directory in `WORKSPACEX_TEST_PORT_LEASE_DIR`, or the default
   machine-wide temporary `workspacex-test-port-leases` directory. Record its owner
   PID/token and correlate it with the failed run, command and owned compose scope.
2. Establish that this run's child/services/descendants have stopped. A dead owner
   PID or an empty listen table alone is insufficient: a surviving child can still
   be starting. If identities or lifecycle are unknown, retain the quarantine.
3. Confirm no listener owns that port, and ensure that no known child can later
   bind it. Do not kill unrelated processes or tear down unowned Docker scopes.
4. Recheck the exact owner PID/token, then remove only that verified port directory
   during coordinated recovery. Never recursively delete the machine-wide lease
   root. Restarting verification is safe only after this proof.

The regression performs this recovery solely inside its disposable fixture, after
its known orphan exits and a genuine OS bind succeeds. It does not prove that an
operator has recovered any existing production or shared-machine quarantine.
