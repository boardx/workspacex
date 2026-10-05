# Candidate-project canonical acceptance

`candidate_canonical_acceptance.py` is the A-route consumer. The older
`canonical_acceptance_receipt.py` explicitly remains a legacy-layout consumer;
its activation source inspects workspacex-cn names and runs an old fixed network.
New factory routes must not call that layout-dependent wrapper.

Input is an existing retained candidate transport plus an identity-bound reviewed
binding with private candidateConfig, candidateNginx, stageInspection, browserPlan
refs and profile-bound nodeBinary. The canonical compiled activation module must
already be supplied by root's byte-pinned FD closure. The consumer uses its
protected reads, installed canonical JS bytes and pinned Node invocation only;
it never calls legacy actual_api/api_job/canonical_checks or patches globals.

The eight stages check identity/lock, candidate config pointer, candidate Nginx,
actual candidate immutable runtime/artifacts/full Docker config/network, frozen
baseline, existing APP data readiness, existing APP service readiness, and existing
canonical publicReadiness. Exact candidate API container ID runs both scripts by
Docker exec, inheriting the actual candidate Compose env/network. No new helper
container, replacement network, baseline name or future release lane is used.
Fixed APP API image WORKDIR is /opt/workspacex/apps/api. Script execution remains
future authorized work: data-readiness itself opens application PG/Redis clients,
cloud-service-readiness reads assistants without starting runs; no commands ran
in these local mock tests.

Full stageInspection must be a qualified source-produced private snapshot with exact schemaVersion/kind/binding/sourceProfileSha256/composeRef/manifestRef/
containers/candidateContainerIds/baselineContainerIds. The kind is
source-inspected-candidate-stage-snapshot at the fixed attempt stage-snapshot.json.
Binding includes identity/tool revision/host/epoch/hold generation. Both ID sets
are exact, unique and disjoint and partition the complete source-inspected raw
Config/HostConfig/Mounts/NetworkSettings. The root profile and protected emitter
options/compose/manifest/network refs are rechecked. Candidate live network is
independently inspected against the source-approved external bridge fact, including
Id/IPAM/Options; stopped snapshot empty NetworkID is allowed only when the live ID
matches that independently verified fact. Names/aliases/DNSNames remain frozen.
Consumer rejects missing fields or drift; a mock snapshot is not production
qualification of the actual source emitter/full configuration checks.

Output is a source-produced canonical-acceptance-completed receipt with eight
passed stages, retained lock and empty owned run IDs (read-only canonical creates
no agent run). persist_candidate_canonical_receipt invokes actual source before
protected immutable store publication. Repeated source calls recheck live inputs;
different output under an already published immutable filename rejects rather
than replacing evidence. Every rejection leaves stop/recovery with A-route; this
consumer has no rollback, writer resume, image pull, SQL mutation or lock release.

Local command: python3 -m unittest discover -s .harness/scripts/vm -p
candidate_canonical_acceptance_test.py — 6/6 passed, exit 0. Covers exact candidate
execution, network/full configuration/project drift, script/public failure and
missing compiled module. Python compilation also exit 0. These are mocked source
checks, not eight actual production stages or business acceptance.

Readiness and service-health commands now share candidate_readonly_docker.py.
Only fixed network-inspect, data-readiness, service-readiness and health operations
exist. Profile bytes, pinned Docker binary FD/hash, root-owned Docker socket
identity and empty private offline Docker config are checked; profile/socket are
rechecked after every command. There is no unchecked /usr/bin/docker fallback.
The helper's four tests include pin failure preventing exec and authority drift.

## Docker state transitions

Primary Moby v24/v27/v28 source distinguishes endpoint cleanup from configuration:
[container_operations.go v27.5.1](https://raw.githubusercontent.com/moby/moby/v27.5.1/daemon/container_operations.go),
[v24.0.9](https://raw.githubusercontent.com/moby/moby/v24.0.9/daemon/container_operations.go).
Stop clears EndpointID, Gateway, IPAddress/prefix, IPv6 gateway/address/prefix and
MAC. It retains NetworkID and names. Candidate start derives DNS names from the
frozen container name, aliases, short ID and hostname; older v24 derives only
short-ID/hostname alias additions. Consumer admits those deterministic transitions
and checks dynamic addresses against the approved IPAM subnet/prefix/gateway.
No network membership, static endpoint setting or arbitrary name change is allowed.

If an actual engine/API inspect clears baseline NetworkID/DNSNames, that behavior
is outside these verified source contracts and currently rejects; obtain version
and inspect evidence before adding an alternate policy. No production Docker was
executed to qualify that behavior.

Sandbox uses exactly the builtin `none` network entry, not an empty network map.
Canonical reads the actual `none` null-driver authority through pinned Docker
before and after acceptance, reuses stage's strict endpoint verifier, and requires
native network ID and actual owner endpoint ID. No IP, route, MAC, DNS/aliases or
published ports are allowed. Only qualified stopped snapshot identity allocation
may change on start. Missing actual authority rejects; no synthetic owner fallback.
Canonical's 14 local mock tests cover these positive and fail-closed transitions.
