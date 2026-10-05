# Fixed candidate staging and held readback

`candidate_stage_actions.py` is inert and runs only through a compiled source-owned
transport. Local tests mock every command. It reuses the existing offline Docker
prefix and frozen APP `createCloudCompose` contract; it never invokes activation,
legacy bootstrap, pull/build/up/start/unpause, production SQL or baseline recreate.

Staging inputs bind fixed identity/tool/host/semantic epoch/held generation and private
manifest/Compose byte hashes. `verify_frozen_compose` must rerender through the pinned
9b25 source and compare the exact output with prepared config/env/secret continuity.
No JSON field chooses a verifier. The candidate project must differ from baseline.
The only mutating command is scoped candidate `compose create --no-build --pull never
--no-deps web api agent sandbox sandbox-sessions`, after a durable stage intent.
Local image inspection verifies exact immutable RepoDigest, OCI source revision,
platform and image ID. Docker network inspect proves the actual project bridge.
API/Web loopback ports, agent service DNS and sandbox network=none remain frozen.
Full source configuration comparison covers environment, ports, mounts, limits,
security flags and namespace wiring; baseline inspection and admission are repeated.

Candidates finish stopped. Docker `start` followed by `pause` cannot guarantee no
application side effect between calls; `start_paused` therefore rejects with a stable
missing-capability code. This module supplies no fake atomic start transport.
Partial create/lost responses retain held admission and durable intent for reconciliation;
no automatic deletion, baseline mutation, pointer change or admission reopening occurs.
Repeated ordinary create uses the same exact project/Compose, never force recreation;
uncertain outcomes require source-owned live readback before another attempt.

The safe inspection result hashes complete Docker Config in memory, retaining only
Compose identity labels and the hash. Env values, mount contents and other arbitrary
runtime values are not included in the emitted evidence. The late candidate-plan
producer consumes this safe shape and rechecks the actual source observation.

Held readback requires a source-derived qualified expected-readback artifact at the
exact `/etc/workspacex-cn/maintenance-readback/{APP}/{attempt}/expected.json` path.
Its hash, fixed binding and qualification evidence hash bind three nonempty closed
sets of seed/data targets, each with targetId, bounded key parameters, explicit count
and digest. `verify_expected_readback` must prove the current-epoch isolated artifact
and source allowlist; a supplied qualified/ready boolean, absent targets or SQL text
cannot do so. Agent/memory expectations must come from their real canonical source
and qualified readback; no default-zero seed assumption exists.

Only retained diagnostic `held-candidate-schema`, `held-candidate-permissions`, and
`held-candidate-seed` fixed queries execute per database, with the sole parameter
`{expectedReadbackSha256}`. The helper reads its pinned artifact/allowlist, performs
parameterized bounded fixed SQL, and must prove read-only transaction and ROLLBACK.
The nine results bind actual retained connection identities and are independently
rechecked for connection/admission drift. API seed semantics reuse the APP bootstrap
agent/version/listing joins, source template stable names and resolved providers.
No legacy bootstrap process or new database connection is opened.

Required actual host facts: pinned Docker binary/local empty auth config/socket,
exact APP Compose/config/private env and stable secrets, immutable local image
inspection, baseline project/container inspections, all closed writer roles, held
identity/host/generation, live project bridge/ports/mount/config proof, six retained
session identities, and qualified three-database expected readback. Missing source
operations reject before create/probes; source code alone does not prove these facts.

Local evidence: six stage tests pass, including frozen topology rejection, wrong local
identity/bridge/config, admission/baseline/session drift, lost create response, absent
atomic start, secret-free inspection, all nine read-only/Rollback results and missing
or caller-qualified seed target rejection. No host installation or production action.
