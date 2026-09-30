import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { validateMigrationSnapshot, migrationLedgerDigest } from "../src/cn-migration-snapshot";
import { binding, fixture } from "./cn-migration-snapshot.fixture";
it("decodes the whole provider response, independently counted rows and source-bound digest", () => {
  const f = fixture(); const result = validateMigrationSnapshot(f.snapshot, binding);
  expect(result.ledger).toEqual(f.sql.ledger); expect(result.independentSqlCount).toBe(1);
  expect(result.ledgerSha256).toBe(migrationLedgerDigest(f.sql.ledger));
});
it("accepts a truly empty ledger only with independently observed zero count", () => {
  expect(validateMigrationSnapshot(fixture([]).snapshot, binding).ledger).toEqual([]);
});
it.each(["schemaVersion", "kind", "capturedAt", "source", "fullResponseBase64", "fullResponseSha256"])("refuses missing envelope %s", key => {
  const f = fixture(); const value = { ...f.snapshot } as Record<string, unknown>; delete value[key];
  expect(() => validateMigrationSnapshot(value, binding)).toThrow("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
});
it("rejects old permissive fixture format and credential-bearing extra fields", () => {
  expect(() => validateMigrationSnapshot({ readOnly: true, ledger: [] }, binding)).toThrow("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
  expect(() => validateMigrationSnapshot({ ...fixture().snapshot, password: "must_not_log" }, binding)).toThrow("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
});
it.each(["independentSqlCount", "ledgerSha256", "querySha256", "source", "readOnly", "transactionIsolation"])("refuses missing SQL proof %s", key => {
  const f=fixture(); delete (f.sql as Record<string,unknown>)[key]; f.seal();
  expect(() => validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
});
it.each([1, 100, undefined])("refuses provider dropped output %s", dropped => {
  const f=fixture(); (f.result as Record<string,unknown>).Dropped=dropped; f.sealResponse();
  expect(() => validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_OUTPUT_DROPPED");
});
it("rejects a perfectly valid truncated subset whose original SQL count proves missing rows", () => {
  const f=fixture(); f.sql.independentSqlCount=255; f.seal();
  expect(() => validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_COUNT_MISMATCH");
});
it("rejects duplicate ledger names even when count and digest have been resealed", () => {
  const f=fixture(); f.sql.ledger.push({...f.sql.ledger[0]!});f.sql.independentSqlCount=2;
  f.sql.ledgerSha256=migrationLedgerDigest(f.sql.ledger);f.seal();
  expect(() => validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_DUPLICATE_NAME");
});
it("rejects mispaired names/checksums when independent canonical digest remains original", () => {
  const f=fixture([{name:"0001.sql",checksum:"a".repeat(64)},{name:"0002.sql",checksum:"b".repeat(64)}]);
  f.sql.ledger.reverse(); [f.sql.ledger[0]!.checksum,f.sql.ledger[1]!.checksum]=[f.sql.ledger[1]!.checksum,f.sql.ledger[0]!.checksum];f.seal();
  expect(() => validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_LEDGER_HASH_MISMATCH");
});
it.each(["endpointSha256", "serverAddressSha256", "database", "user", "port", "dbInstanceId", "accountId", "regionId"])("rejects source mismatch %s", key => {
  const f=fixture();(f.snapshot.source as Record<string,unknown>)[key]=key==="port"?5433:"0".repeat(64);
  expect(() => validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_SOURCE_MISMATCH");
});
it.each(["InstanceId", "InvokeId", "CommandId"])("rejects command identity mismatch %s", key => {
  const f=fixture();(f.result as Record<string,unknown>)[key]="wrong";f.sealResponse();
  expect(() => validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_CLOUD_IDENTITY_MISMATCH");
});
it("rejects SQL connection mismatch even if envelope is correct",()=>{
 const f=fixture();f.sql.source.database="wrong";f.seal();expect(()=>validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_SQL_IDENTITY_MISMATCH");
});
it("rejects bad response/base64, corrupt or extra output, unsuccessful and paginated results", () => {
  const f=fixture(); expect(()=>validateMigrationSnapshot({...f.snapshot,fullResponseSha256:"0".repeat(64)},binding)).toThrow("MIGRATION_SNAPSHOT_RESPONSE_HASH_MISMATCH");
  expect(()=>validateMigrationSnapshot({...f.snapshot,fullResponseBase64:"not valid base64"},binding)).toThrow("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  for(const output of [Buffer.from("truncated gzip").toString("base64"),Buffer.from("WSX_CN_MIGRATION_SNAPSHOT_V1=AAAA\nSECRET").toString("base64")]){
    const x=fixture();x.result.Output=output;x.sealResponse();expect(()=>validateMigrationSnapshot(x.snapshot,binding)).toThrow();
  }
  const partial=fixture();partial.response.Invocation.TotalCount=2;partial.sealResponse();expect(()=>validateMigrationSnapshot(partial.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const failed=fixture();failed.result.ExitCode=1;failed.sealResponse();expect(()=>validateMigrationSnapshot(failed.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_COMMAND_FAILED");
});
it("refuses private evidence symlink/shared permissions and does not reveal file contents", async () => {
  const { mkdtempSync, writeFileSync, symlinkSync, rmSync } = await import("node:fs");
  const { join }=await import("node:path");const { tmpdir }=await import("node:os");
  const { readMigrationSnapshotFile }=await import("../src/cn-migration-snapshot");
  const dir=mkdtempSync(join(tmpdir(),"snapshot-private-"));
  try {
    const good=join(dir,"private.json");writeFileSync(good,JSON.stringify(fixture().snapshot),{mode:0o600});
    expect(readMigrationSnapshotFile(good)).toEqual(fixture().snapshot);
    const shared=join(dir,"shared.json");writeFileSync(shared,"PRIVATE_SECRET",{mode:0o644});
    const link=join(dir,"link.json");symlinkSync(good,link);
    for(const path of [shared,link])expect(()=>readMigrationSnapshotFile(path)).toThrow("MIGRATION_SNAPSHOT_PRIVATE_FILE_INVALID");
  } finally {rmSync(dir,{recursive:true,force:true});}
});
it("rejects internal pagination tokens and unsafe UTF8/gzip including expansion bombs",()=>{
  const f=fixture();(f.response.Invocation as Record<string,unknown>).NextToken="more";f.sealResponse();
  expect(()=>validateMigrationSnapshot(f.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  for(const bytes of [Buffer.from([0xff]),gzipSync(Buffer.alloc(8*1024*1024+1))]) {
    const x=fixture();x.result.Output=Buffer.from("WSX_CN_MIGRATION_SNAPSHOT_V1="+bytes.toString("base64")).toString("base64");x.sealResponse();
    expect(()=>validateMigrationSnapshot(x.snapshot,binding)).toThrow("MIGRATION_SNAPSHOT_OUTPUT_INVALID");
  }
});
