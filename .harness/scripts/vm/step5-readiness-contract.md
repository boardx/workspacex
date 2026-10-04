# Step 5 prepare/readiness collector

Scope: frozen 9b25 maintenance path; read-only evidence producer, no production execution.

Inputs: exact candidate plan, held lock/generation, boot identity, nonce, live Docker inventory,
complete process/fd/cgroup and per-network-namespace TCP visibility, fixed read-only database
session query. Source must supply live target-bound provider authority for the existing
`aliyun-postgresql-serverless-no-tls` exception; ssl=false alone is rejected.

Output: existing candidate backend seal after all session/socket/container identity joins,
then repeat reads of process start, fd ownership, namespace TCP, database sessions, inventory,
lock and hold. Repeated calls collect fresh evidence and never mutate production; stale evidence
is rejected rather than reused. Failure emits a stable collector code and no readiness proof.

Rollback: none needed for this read-only collector. A caller must retain held admission on failure.
Prepared receipt and activation require downstream independent validation.

Bridge SNAT uses a complete live conntrack original/reply join and paired namespace/conntrack
seal witness; missing, duplicate, wrong-target or raced mappings fail closed. `conntrack_rows`
normalizes a complete host nf_conntrack snapshot without discarding tuple direction. No host
transport has been invented; trusted source methods are obligations, not supplied dict admission.
Sandbox network=none remains excluded as a database writer; it cannot own a proven DB socket.
API loopback publishing and agent service DNS are not rewritten by collection.

Evidence: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .harness/scripts/vm -p test_candidate_backend_collector.py`
passes ten tests including namespace direct join, complete TLS authority positive/negative cases,
SNAT positive/negative tuple joins, shared seal tuple/port/namespace tampering, no-authority rejection, process/fd/database races and shared socket ownership.

Trusted source contracts:

- `read_candidate_conntrack()` returns the complete normalized list produced by
  `conntrack_rows` from host nf_conntrack readback; each record has `original` and `reply`
  with `srcAddr`, `srcPort`, `dstAddr`, `dstPort`. Permission/truncation errors must raise.
  No method means direct tuples only. No arbitrary shell or SQL input is accepted.
- `read_candidate_transport_evidence(db)` calls the source-owned retained helper
  `verify-live-transport`, which reuses `approveExistingMaintenanceTransportInputs`,
  `verifyExistingMaintenanceTransport` and `verifyRdsTransportPreflight` on fresh raw
  Describe provider responses. The collector does not reinterpret provider Category,
  DBInstanceClass or SSL enum values. Output fields are exactly `schemaVersion=1`,
  `kind=existing-production-maintenance-transport-verified`, `identity`, exact `peer`,
  `endpoint={address,port}`, `observedAt` and `proof={sslMode:disable,configurationSha256,providerEvidenceSha256}`.
  Identity/peer/hash binding must remain stable over two fresh reads, each at most
  thirty seconds old. Diagnostic session evidence is not relabeled as app session proof.
- `collect_opened(plan,nonce)` requires hold state `cleared`, with the identical
  generation and identity. It preserves every socket, namespace, conntrack, PID/FD
  and database drift check used by held collection; it cannot fabricate a held state.

The shared seal tests mutate all eight original/reply address/port fields, drop each paired
namespace/conntrack field, inject Boolean/string/out-of-range ports and forged namespaces.
All reject. These local fixtures prove contract behavior; they do not prove provider access,
actual host namespace visibility, production readiness or release permission.

When PostgreSQL reports `inet_server_addr()=null`, the plan/peer identity remains null.
Only the source helper verified exact endpoint may match direct sockets or both SNAT
directions. The socket witness adds `endpointAuthority={address,port,configurationSha256,
providerEvidenceSha256}` only for this case. Missing authority, wrong endpoint, stale or
raced proof rejects; host and bridge SNAT tests cover these cases and seal tampering.
