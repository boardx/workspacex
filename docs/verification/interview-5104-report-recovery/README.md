# Report recovery #5104

A nonempty report rejected by the existing analysis quality gate previously threw without saving the original output. This change retains the rejected bytes as a failed version and permits at most one full quality repair. It does not establish the cause of the two real acceptance 503 responses.

New report requests have at most two model calls. Retrying an existing failed report has one full rewrite call. A normal qualified report still has one call and one save. The same quality gate applies to the replacement; failure, interruption or truncation cannot grant draft/approval status. Both failed versions remain in history with their exact bytes, content hashes, references and simulated evidence boundary. Before an automatic second call, a new authorized read checks the exact aggregate/document version, revision and retained bytes. Each save repeats persistence CAS and authorization.

Validation on the uncommitted implementation based on 2304fef0e87e3f037e0f0c4c9ce62c0cf669029d:
- Pure suite: 4 files, 32 tests passed (recovery 7, diagnostics 13, existing quality 8, context 4).
- API TypeScript check and standard API lint: exit 0.
- Baseline comparison: original generator from 2304fef was replayed against the recovery tests, producing 6 failures/1 pass. This was a controlled replay after implementation, not the original pre-implementation run. The initial actual failing pure run also had 6 failures/1 pass, but its temporary log was overwritten during database test preparation; no database red is claimed.
- Final PostgreSQL suite: 2 files/16 tests passed (recovery 6, existing execution 10); all three application source hashes are identical before and after. Exact owned compose containers/volumes were verified absent after cleanup. PostgreSQL is isolated and real; model responses are controlled synthetic fixtures. These tests do not demonstrate real provider latency or generated content quality.

Dependency: PR #5101 supplies diagnostic instrumentation. This PR is based on its branch and contains only #5104 changes. No export changes, no production/model configuration changes, no external model calls.

Unverified: cause of the real 503, real model recovery, browser recovery and real latency improvement. The external diagnostic call remains unauthorized. Existing logs contain the normalized HTTP 503 only, without provider/quality detail; no root cause is inferred from them.
