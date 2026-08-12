# Isolation Fixture Admission Design

## Problem

`fullstack-smoke.test.ts` verifies the lifecycle of `with-test-isolation.ts` by spawning the production CLI. The production CLI correctly consults real stack admission, but that makes the lifecycle test depend on the host's current load. Under load, its child waits in admission longer than the test's ready and exit watchdogs, so `verify:base` fails without a product regression.

## Design

Extract the wrapper lifecycle into an exported function whose only injected dependency is `acquireStackSlot`. The normal CLI entry calls it with the real admission function. A test-only fixture entry calls the same lifecycle with an immediate slot, and `fullstack-smoke.test.ts` spawns that fixture for exit-code, signal, and cleanup assertions.

The fixture changes only admission timing. It still launches a real child process, executes the real cleanup path, propagates signals, and preserves exit codes. Production policy (`maxStacks=2`, `maxLoadPerCore=2.5`) and watchdog durations remain unchanged.

## Safety checks

- A source assertion proves the production entry still uses real admission.
- A source assertion proves no package script references the fixture.
- Existing lifecycle assertions continue to exercise real subprocess and cleanup behavior.
- The dedicated stack-admission unit tests remain the authority for load and slot policy.

