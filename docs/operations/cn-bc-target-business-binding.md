# BC target receipt binding (source-only)

Issue: https://github.com/boardx/workspacex/issues/5736

Application source is `bc3d1254ce05c915801fb73fe6698072730a051c` (BC).
Tool and original case source is `aa36786188de51a0dc11b15cc1ffa2d192666555` (AA).
These are independent identities. AA application execution cannot attest BC.

## Existing execution path remains the release path

The existing approved continuation invokes `cn-release-business-observer.py`
with the approved release hash. Its `execute` uses the original business state
adapter, privileged lock/FD9 and owned cgroup, then business entry/runner and
canonical browser assertions. The identity already separates sourceRevision
from controlRevision. BC source plus AA control is supported by that contract;
this new wrapper is not required to use it and adds no gate to that path.

Actual execution still requires the original approved release identity and code
closure, installed pinned AA runtime/profile, maintenance plan and scoped QA
fixture/credentials, actual BC image inventory and deployment marker, and the
original live clear/writer/A5 admission evidence. Original readback must verify
all six journeys and three persisted owned acceptance runs against live state.
These inputs must come through existing trusted adapters. A build success or
caller-supplied success flags cannot substitute for them. This change neither
supplies those inputs nor authorizes production business writes, new installation,
a probe, seed, migration or credential copying.

There is no complete isolated BC candidate-image adapter in this change. Native
source fixtures and synthetic adapter unit tests are not BC image acceptance.
The existing AA tool package is unchanged and does not contain this new wrapper.

## Optional future sidecar

`scripts/cn-release-target-business.py` wraps the fixed existing observer with no
CLI and no caller-provided adapter/LiveState. It requires root-owned private
installed files, exact original AA byte hashes, original profile/QA preflight,
and explicit approval of its own bytes. Current canonical approval generation
and installed inventory do not include this file: it is deliberately not an
executable deployment path today. Future installation/admission work requires
separate review; do not expand the current installer or closure just to use it.

`observe` delegates unchanged original journeys and requires original readback.
`readback` never replays journeys. The original receipt bytes remain unchanged.
An exclusive `target-bc-binding.json` sidecar binds the original raw receipt SHA,
application/control/tool/case identities, tool profile/file digest, canonical
case file hash, wrapper hash, runtime inventory digest, marker and three owned
run IDs. The sidecar is a historical binding to `originalObservedAt`.
`liveAtSidecarWriteVerified` is false: original readback releases its lock before
sidecar writing, so the sidecar is not a new live-state attestation.

Diagnostic coverage is only identity binding. No AA passive readtap or R01 stage
has been attached; eventCount is zero and both attachment flags are false. No
new business pass is asserted. Exceptions expose fixed codes only; QA plan,
credentials and arbitrary adapter errors are never serialized.

## Verification scope

Run `python3 -B -m unittest discover -s tests -p test_cn_release_target_business.py`.
The 15 tests use an explicitly synthetic internal adapter, with no browser,
Docker, production or network calls. They verify unchanged raw bytes, independent
identities, original observe/readback order, no replay, absent admission/QA zero
send, AA runtime rejection, wrong tool/case hashes, context and receipt drift,
exact six checks/three run IDs, sidecar conflict and sanitized failures. They do
not establish any actual BC business result. The original seven pinned sources
are unchanged.
