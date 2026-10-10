# Isolated runner with an external lifecycle owner

This optional control mode consumes independently approved preparation evidence. It does not create resources, credentials, accounts, policies or grants. The Mac coordinator owns cloud mutations; the runner performs isolated SQL and fresh provider reads. Missing `lifecycle` retains the existing standalone behavior. A present invalid mode fails closed.

```mermaid
flowchart LR
 A[Root-pinned external preparation] --> B[Fresh account and OOS reads]
 B --> C[Original eight isolated stages]
 C --> D[Close admission]
 D --> E[External exact cleanup and stop proof]
 classDef checked fill:#ddd6fe,stroke:#7c3aed,color:#111;
 classDef pending fill:#e5e7eb,stroke:#6b7280,color:#111;
 class A,B,C,D checked;
 class E pending;
```

The protected root manifest adds exactly:

```json
{"lifecycle":{"mode":"external-owner-v1","owner":"mac-coordinator","preparedReceipt":{"path":"ABSOLUTE_PRIVATE_PATH","sha256":"RAW_SHA256"},"targetSecret":{"path":"ABSOLUTE_PRIVATE_PATH","sha256":"RAW_SHA256"}}}
```

These references are fixed in the durable admission binding. Changing owner, mode or either reference within an attempt is rejected. The original root manifest SHA remains the independent authority; hashes supplied by an untrusted cloud object are not approval. All referenced evidence and secrets must be owner-private ordinary files. `targetSecret` uses the existing seven-account structure and exact target/peer/TLS bindings, loaded without generating secrets. A safe coordinator creation/delivery mechanism remains a deployment prerequisite; passwords must not be placed in CLI argv.

`isolated_external_lifecycle.load` defines the strict prepared receipt schema:

- `schemaVersion=1`, `kind=isolated-external-lifecycle-prepared-v1`.
- `binding`: exactly accountId, regionId, attemptId, candidateSha, targetInstanceId, providerCreatedUtc. `runnerInstanceId` equals the protected lifetime observation.
- `ownerJournal`: private hash reference to a strict `schemaVersion=1`, `kind=isolated-owner-journal-projection-v1` projection with exact binding, owner, matching emptyAccounts reference and exactly eight `operations` (account:migration_admin, six account:ROLE names, oos). Each operation has intent/dispatch/ack references; intent and ack must equal the prepared receipt's references. The dispatch document binds schemaVersion=1, kind=isolated-owner-dispatch-v1, exact binding/operation, intentSha256, ackSha256, state=acknowledged and requestSha256. The request digest is SHA256 of sorted compact JSON `{service,action,parameters}`, including the actual password in memory for CreateAccount; the private digest and secret must never be logged. Unknown or mismatched dispatches cannot produce admission. This projection must be produced from the external owner's real durable records, not manually populated flags.
- `observedUtc`: timezone timestamp between target creation and current time plus 30 seconds. This historical preparation stamp does not substitute for fresh runner reads.
- `emptyAccounts`: private reference to exact RegionId/DBInstanceId/PageNumber=1/PageSize=100 parameters plus a complete original zero-account response and RequestId. The original empty-account guard is retained as protected evidence.
- `accounts`: exactly migration_admin and the six fixed Normal roles, each with private `intent` and provider `ack` references. Normal intents retain the original random bootstrap nonce and description. The admin intent binds the exact source/target attempt and Super type.
- `accountReadback`: complete seven-account provider response including exact target, account descriptions, types, Available status and RequestId.
- `oos`: exactly executionId, startIntent, startAck, template, readback, templateReadback. All except executionId are private hash references. The original successful StartExecution acknowledgement must name the same execution; the template must equal the existing exact RDS creation+6900-second cleanup template. Description matching alone never adopts an execution.

The runner needs separately approved `DescribeAccounts` and RDS metadata reads plus `oos:ListExecutions`/`oos:GetExecutionTemplate`. No permission is provisioned by this patch. ListExecutions uses exact ExecutionId and MaxResults=10, supported by the [official API schema](https://www.alibabacloud.com/help/en/oos/developer-reference/api-oos-2019-06-01-listexecutions). Missing permission, pagination, missing accounts, wrong descriptions, terminal OOS or changed template prevent stage admission. There is no cached-proof fallback.

The adapter rejects all cloud mutation operations before IMDS access in external mode. Its RPC credential context independently permits only fixed read actions. Before every original SQL-bearing stage the loop checks admission, revalidates the external preparation and obtains fresh exact account/OOS observations. SQL role attributes/membership, restoration, migration and conservation checks remain unchanged.

The `finally` block always attempts to close admission. It performs no runner-side RDS/OOS/IAM deletion in external mode; temporary subprocess directories retain their existing local cleanup. A close failure prevents successful return. The outer coordinator must retain the original cloud journal before dispatch, perform exact cleanup on success/failure/disconnection, and verify exact ECS plus original disk/ENI absence. The work cutoff remains `min(runner AutoReleaseTime, RDS creation+7200)-330`; no retry or extension is introduced. OOS and ECS timed release remain independent fallbacks, not guarantees of exact physical deletion time.

Successful external execution returns `stagesCompleted:true`, `cleanupPending:true`, `a3Accepted:false`, `workloadStoppedProven:false`. It does not return standalone `accepted`/`deleted` success. This patch does not implement six browser journeys, historical quiescence, fixture mutations, HTTPS, new network rules, API IMDS access, secret delivery, or an external receipt exporter. Those require separate completed contracts and approval. It must not be used to claim A3 completion.

The new module is included in the installed tool FILES, allowed isolated producer closure and CI. The production qualification FD bundle still consumes only existing `STAGES`/`validate_binding`; its runtime module list and production authority are unchanged. Executable isolated adapters must include the new module in their hash-pinned transitive module map; the existing preflight rejects omissions.
