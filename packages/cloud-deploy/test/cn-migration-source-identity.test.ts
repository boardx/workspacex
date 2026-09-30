import { expect,it } from "vitest";
import { binding,fixture } from "./cn-migration-snapshot.fixture";
import { migrationSnapshotBindingSchema,validateMigrationSnapshot } from "../src/cn-migration-snapshot";
import { identityHash,providerIdentityDigest } from "../src/cn-migration-source-identity";
function proxy(){const b=migrationSnapshotBindingSchema.parse(structuredClone(binding));b.source.identityLane="aliyun-private-endpoint";b.source.serverAddressSha256=null;b.source.port=null;
 const f=fixture();Object.assign(f.sql.source,b.source);Object.assign(f.snapshot.source,b.source);f.seal();return {b,f};}
it("accepts explicit backend inet NULL only with independent RDS/STS/private config and observed TCP peer",()=>{const {b,f}=proxy();expect(validateMigrationSnapshot(f.snapshot,b).independentSqlCount).toBe(1);});
it.each(["port","serverAddressSha256"])("rejects mixed NULL %s even if SQL/envelope/expected are resealed",key=>{const {b,f}=proxy();Object.assign(b.source,{[key]:key==="port"?5432:"f".repeat(64)});Object.assign(f.sql.source,b.source);Object.assign(f.snapshot.source,b.source);f.seal();expect(()=>validateMigrationSnapshot(f.snapshot,b)).toThrow("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");});
it("does not allow SQL to select the fallback lane",()=>{const {f}=proxy();expect(()=>validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_SOURCE_MISMATCH");});
it("rejects missing NULL, source evidence and legacy protocol",()=>{for(const key of ["port","serverAddressSha256"]){const {b,f}=proxy();delete (f.sql.source as Record<string,unknown>)[key];f.seal();expect(()=>validateMigrationSnapshot(f.snapshot,b)).toThrow();}const {b,f}=proxy();expect(()=>validateMigrationSnapshot(f.snapshot,{...b,sourceEvidence:undefined})).toThrow();expect(()=>validateMigrationSnapshot({...f.snapshot,schemaVersion:1},b)).toThrow();});
it.each(["account","region","instance","hostname","port","vpc","public","loopback","peer","configuration"])("rejects independently resealed bad external identity %s",bad=>{
 const {b,f}=proxy(),e=b.sourceEvidence,a=e.attributeResponse.Items.DBInstanceAttribute[0]!,n=e.netInfoResponse.DBInstanceNetInfos.DBInstanceNetInfo[0]!;
 if(bad==="account")e.stsResponse.AccountId="wrong";if(bad==="region")a.RegionId="wrong";if(bad==="instance")a.DBInstanceId="wrong";if(bad==="hostname")n.ConnectionString="wrong.internal";if(bad==="port")n.Port="5433";if(bad==="vpc")n.VPCId="wrong";if(bad==="public")n.IPType="Public";if(bad==="loopback"){n.IPAddress="127.0.0.1";b.source.clientPeerAddressSha256=identityHash(n.IPAddress);}if(bad==="peer")b.source.clientPeerAddressSha256="b".repeat(64);if(bad==="configuration")e.configuration.sha256="0".repeat(64);
 b.source.providerEvidenceSha256=providerIdentityDigest(e);Object.assign(f.sql.source,b.source);Object.assign(f.snapshot.source,b.source);f.seal();expect(()=>validateMigrationSnapshot(f.snapshot,b)).toThrow("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");
});
it("allows existing configured no-TLS exception only with CIDR and actual unencrypted socket, never silently downgrades",()=>{
 const {b,f}=proxy();b.source.sslMode="disable";b.source.clientEncrypted=false;b.source.clientTlsAuthorized=false;b.sourceEvidence.configuration.sslMode="disable";
 Object.assign(f.sql.source,b.source);Object.assign(f.snapshot.source,b.source);f.seal();expect(()=>validateMigrationSnapshot(f.snapshot,b)).toThrow("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");
 b.sourceEvidence.configuration.rdsTlsException={kind:"aliyun-postgresql-serverless-no-tls",allowedCidrs:["10.0.0.0/8"]};expect(validateMigrationSnapshot(f.snapshot,b).independentSqlCount).toBe(1);
 b.sourceEvidence.configuration.rdsTlsException.allowedCidrs=["192.168.0.0/16"];expect(()=>validateMigrationSnapshot(f.snapshot,b)).toThrow("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");
});
it("verify-full requires actual encryption and TLS authorization",()=>{for(const key of ["clientEncrypted","clientTlsAuthorized"]){const {b,f}=proxy();Object.assign(b.source,{[key]:false});Object.assign(f.sql.source,b.source);Object.assign(f.snapshot.source,b.source);f.seal();expect(()=>validateMigrationSnapshot(f.snapshot,b)).toThrow("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");}});
it("NULL lane retains all independent count and provider Dropped gates",()=>{const {b,f}=proxy();f.sql.independentSqlCount=255;f.seal();expect(()=>validateMigrationSnapshot(f.snapshot,b)).toThrow("MIGRATION_SNAPSHOT_COUNT_MISMATCH");const x=proxy();x.f.result.Dropped=1;x.f.sealResponse();expect(()=>validateMigrationSnapshot(x.f.snapshot,x.b)).toThrow("MIGRATION_SNAPSHOT_OUTPUT_DROPPED");});
it("derives expected source only after independently protected metadata and external provider checks",async()=>{
 const {deriveMigrationSourceIdentity}=await import("../src/cn-migration-source-identity");const {b}=proxy();
 const audit={schemaVersion:1,readOnly:true,configuredRegionId:"synthetic-region",configuredRdsInstanceId:"synthetic-db",configurationSha256:b.source.configurationSha256,endpointSha256:b.source.endpointSha256,
  database:b.source.database,user:b.source.user,serverAddressSha256:null,port:null,clientPeerAddressSha256:b.source.clientPeerAddressSha256,
  clientPeerPort:b.source.clientPeerPort,sslMode:b.source.sslMode,clientEncrypted:true,clientTlsAuthorized:true};
 expect(deriveMigrationSourceIdentity(b.sourceEvidence,audit,"aliyun-private-endpoint").source).toEqual(b.source);
 expect(()=>deriveMigrationSourceIdentity(b.sourceEvidence,{...audit,configurationSha256:"0".repeat(64)},"aliyun-private-endpoint")).toThrow("MIGRATION_SNAPSHOT_PROTECTED_CONFIGURATION_MISMATCH");
 expect(()=>deriveMigrationSourceIdentity(b.sourceEvidence,{...audit,endpointSha256:"0".repeat(64)},"aliyun-private-endpoint")).toThrow("MIGRATION_SNAPSHOT_PROTECTED_CONFIGURATION_MISMATCH");
 expect(()=>deriveMigrationSourceIdentity(b.sourceEvidence,{...audit,port:5432},"aliyun-private-endpoint")).toThrow("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");
});
it("provider identity digest preserves full response contents but is stable across JSON key order",()=>{const {b}=proxy();const e=b.sourceEvidence;const reordered={...e,stsResponse:{AccountId:e.stsResponse.AccountId,RequestId:e.stsResponse.RequestId}};expect(providerIdentityDigest(reordered)).toBe(providerIdentityDigest(e));expect(providerIdentityDigest({...e,stsResponse:{...e.stsResponse,PrincipalId:"changed"}})).not.toBe(providerIdentityDigest(e));});
