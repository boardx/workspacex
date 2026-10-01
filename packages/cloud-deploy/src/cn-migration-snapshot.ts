/** Validate private, complete provider output before constructing a migration inventory. */
import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { migrationSourceSchema, sourceEvidenceSchema, verifyExternalSourceIdentity } from "./cn-migration-source-identity";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const utc = z.string().datetime({ offset: false });
const count = z.number().int().nonnegative().max(100000);
const source = migrationSourceSchema;
export const migrationSnapshotBindingSchema = z.object({ schemaVersion: z.literal(2), source, sourceEvidence: sourceEvidenceSchema,
  cloud: z.object({ ecsInstanceId: id, invokeId: id, commandId: id, querySha256: hash }).strict(),
}).strict();
export type MigrationSnapshotBinding = z.infer<typeof migrationSnapshotBindingSchema>;
const envelope = z.object({ schemaVersion: z.literal(2), kind: z.literal("cn-readonly-migration-snapshot"),
  capturedAt: utc, source, fullResponseBase64: z.string().min(1), fullResponseSha256: hash,
}).strict();
const row = z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/).max(255), checksum: hash }).strict();
const payload = z.object({ schemaVersion: z.literal(2), kind: z.literal("cn-migration-ledger-output"),
  querySha256: hash, readOnly: z.literal(true), transactionIsolation: z.literal("repeatable read"),
  source, independentSqlCount: count, ledger: z.array(row).max(100000), ledgerSha256: hash,
}).strict();
const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
export function migrationLedgerDigest(ledger: Array<{ name: string; checksum: string }>): string {
  return sha256(JSON.stringify([...ledger].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}
export class MigrationSnapshotError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MigrationSnapshotError"; }
}
function fail(code: string): never { throw new MigrationSnapshotError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) fail("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
  return result.data;
}
function decode64(value: string, max: number): Buffer {
  if (value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length > max) fail("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  return bytes;
}
function json(bytes: Buffer): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail("MIGRATION_SNAPSHOT_RESPONSE_INVALID"); }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
/** Full DescribeInvocationResults JSON is retained privately, never projected with zip/index alignment.
 * Cloud Output is base64 UTF8 containing a single prefixed gzip/base64 JSON payload, avoiding
 * the provider's 24KB output limit. Dropped must STILL equal zero, not assumed from compression.
 */
export function validateMigrationSnapshot(value: unknown, expectedValue: unknown) {
  const expected = parse(migrationSnapshotBindingSchema, expectedValue);
  const input = parse(envelope, value);
  if (!verifyExternalSourceIdentity(expected.source, expected.sourceEvidence)) fail("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");
  if (JSON.stringify(input.source) !== JSON.stringify(expected.source)) fail("MIGRATION_SNAPSHOT_SOURCE_MISMATCH");
  const bytes = decode64(input.fullResponseBase64, 2 * 1024 * 1024);
  if (sha256(bytes) !== input.fullResponseSha256) fail("MIGRATION_SNAPSHOT_RESPONSE_HASH_MISMATCH");
  const response = object(json(bytes));
  if (typeof response.RequestId !== "string" || !response.RequestId || (response.NextToken !== undefined && response.NextToken !== "")) fail("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const invocation = object(response.Invocation);
  if (invocation.TotalCount !== 1 || (invocation.NextToken !== undefined && invocation.NextToken !== "")) fail("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const results = object(invocation.InvocationResults).InvocationResult;
  if (!Array.isArray(results) || results.length !== 1) fail("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const result = object(results[0]);
  if (result.Dropped !== 0) fail("MIGRATION_SNAPSHOT_OUTPUT_DROPPED");
  if (result.ExitCode !== 0 || result.InvocationStatus !== "Success" || (result.ErrorCode !== undefined && result.ErrorCode !== "")) fail("MIGRATION_SNAPSHOT_COMMAND_FAILED");
  if (result.InstanceId !== expected.cloud.ecsInstanceId || result.InvokeId !== expected.cloud.invokeId || result.CommandId !== expected.cloud.commandId) fail("MIGRATION_SNAPSHOT_CLOUD_IDENTITY_MISMATCH");
  if (!utc.safeParse(result.FinishedTime).success || typeof result.Output !== "string") fail("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  const finished = Date.parse(result.FinishedTime as string);
  if (Date.parse(input.capturedAt) < finished) fail("MIGRATION_SNAPSHOT_TIME_INVALID");
  const prefix = "WSX_CN_MIGRATION_SNAPSHOT_V2=";
  let output: string;
  try { output = new TextDecoder("utf-8", { fatal: true }).decode(decode64(result.Output, 24 * 1024)); }
  catch { return fail("MIGRATION_SNAPSHOT_ENCODING_INVALID"); }
  if (!output.startsWith(prefix) || !/^WSX_CN_MIGRATION_SNAPSHOT_V2=[A-Za-z0-9+/]+={0,2}\n?$/.test(output)) fail("MIGRATION_SNAPSHOT_OUTPUT_INVALID");
  let decoded: unknown;
  try { decoded = json(gunzipSync(decode64(output.slice(prefix.length).trimEnd(), 24 * 1024), { maxOutputLength: 8 * 1024 * 1024 })); }
  catch { return fail("MIGRATION_SNAPSHOT_OUTPUT_INVALID"); }
  const sql = parse(payload, decoded);
  if (JSON.stringify(sql.source) !== JSON.stringify(expected.source) || sql.querySha256 !== expected.cloud.querySha256) fail("MIGRATION_SNAPSHOT_SQL_IDENTITY_MISMATCH");
  if (sql.independentSqlCount !== sql.ledger.length) fail("MIGRATION_SNAPSHOT_COUNT_MISMATCH");
  if (new Set(sql.ledger.map(item => item.name)).size !== sql.ledger.length) fail("MIGRATION_SNAPSHOT_DUPLICATE_NAME");
  if (migrationLedgerDigest(sql.ledger) !== sql.ledgerSha256) fail("MIGRATION_SNAPSHOT_LEDGER_HASH_MISMATCH");
  return { ledger: [...sql.ledger].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    sourceBindingSha256: sha256(JSON.stringify(expected)), snapshotSha256: sha256(JSON.stringify(input)), fullResponseSha256: input.fullResponseSha256,
    ledgerSha256: sql.ledgerSha256, independentSqlCount: sql.independentSqlCount,
    capturedAt: input.capturedAt, scope: "validated-private-read-only-snapshot" as const };
}

/** Inputs are private evidence, not public logs; reject symlinks, shared permissions and wrong owner. */
export function readMigrationSnapshotFile(path: string): unknown {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.()
      || (stat.uid === 0 && stat.gid !== 0) || stat.size > 3 * 1024 * 1024) fail("MIGRATION_SNAPSHOT_PRIVATE_FILE_INVALID");
    return json(readFileSync(fd));
  } catch { return fail("MIGRATION_SNAPSHOT_PRIVATE_FILE_INVALID"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
