/** Synthetic identities only. Not production evidence or provider invocation. */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { identityHash,providerIdentityDigest } from "../src/cn-migration-source-identity";
import { migrationLedgerDigest } from "../src/cn-migration-snapshot";
export const sourceEvidence={request:{regionId:"synthetic-region",dbInstanceId:"synthetic-db"},
 configuration:{sha256:"d".repeat(64),regionId:"synthetic-region",rdsInstanceId:"synthetic-db",endpointSha256:identityHash("fixture.internal:5432"),host:"fixture.internal",port:5432,database:"fixture",user:"fixture_ro",sslMode:"verify-full" as const},
 stsResponse:{RequestId:"synthetic-sts",AccountId:"synthetic-account"},
 attributeResponse:{RequestId:"synthetic-attribute",Items:{DBInstanceAttribute:[{DBInstanceId:"synthetic-db",RegionId:"synthetic-region",Engine:"PostgreSQL" as const,InstanceNetworkType:"VPC" as const,DBInstanceNetType:"Intranet" as const,DBInstanceStatus:"Running" as const,ConnectionString:"fixture.internal",Port:"5432",VpcId:"synthetic-vpc"}]}},
 netInfoResponse:{RequestId:"synthetic-net",InstanceNetworkType:"VPC" as const,DBInstanceNetInfos:{DBInstanceNetInfo:[{IPType:"Private",VPCId:"synthetic-vpc",Port:"5432",ConnectionString:"fixture.internal",IPAddress:"10.0.0.8"}]}},
};
export const binding = { schemaVersion: 2, source: { accountId: "synthetic-account", regionId: "synthetic-region",
 dbInstanceId: "synthetic-db", database: "fixture", user: "fixture_ro", endpointSha256: identityHash("fixture.internal:5432"),
 serverAddressSha256: "f".repeat(64), port: 5432,identityLane:"sql-server-address" as const,
 clientPeerAddressSha256:identityHash("10.0.0.8"),clientPeerPort:5432,configurationSha256:sourceEvidence.configuration.sha256,
 providerEvidenceSha256:providerIdentityDigest(sourceEvidence),sslMode:"verify-full" as const,clientEncrypted:true,clientTlsAuthorized:true},sourceEvidence,
 cloud: { ecsInstanceId: "synthetic-ecs", invokeId: "synthetic-invoke", commandId: "synthetic-command", querySha256: "c".repeat(64) } };
export function fixture(ledger = [{ name: "0001_fixture.sql", checksum: "a".repeat(64) }]) {
  const sql = { schemaVersion: 2, kind: "cn-migration-ledger-output", querySha256: binding.cloud.querySha256,
    readOnly: true, transactionIsolation: "repeatable read", source: { ...binding.source },
    independentSqlCount: ledger.length, ledger, ledgerSha256: migrationLedgerDigest(ledger) };
  const result = { InstanceId: binding.cloud.ecsInstanceId, InvokeId: binding.cloud.invokeId,
    CommandId: binding.cloud.commandId, Dropped: 0, InvocationStatus: "Success", ExitCode: 0,
    FinishedTime: "2026-09-30T18:00:00Z", Output: "" };
  const response = { RequestId: "synthetic-request", Invocation: { TotalCount: 1, InvocationResults: { InvocationResult: [result] } } };
  const snapshot = { schemaVersion: 2, kind: "cn-readonly-migration-snapshot", capturedAt: "2026-09-30T18:00:01Z",
    source: { ...binding.source }, fullResponseBase64: "", fullResponseSha256: "" };
  const seal = () => {
    result.Output = Buffer.from(`WSX_CN_MIGRATION_SNAPSHOT_V2=${gzipSync(JSON.stringify(sql)).toString("base64")}\n`).toString("base64");
    return sealResponse();
  };
  const sealResponse = () => { const bytes = Buffer.from(JSON.stringify(response)); snapshot.fullResponseBase64 = bytes.toString("base64");
    snapshot.fullResponseSha256 = createHash("sha256").update(bytes).digest("hex"); return snapshot; };
  seal(); return { sql, result, response, snapshot, seal, sealResponse };
}
