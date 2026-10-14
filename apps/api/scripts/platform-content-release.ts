/** Root-controlled CLI; credentials stay in the existing one-shot process environment. */
import { closeSync, constants, fstatSync, openSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { toOrgId } from "../src/domain/org-id";
import { ContentReleaseRejected, need, sha, verifyInputs, stateDigest, synchronize, readback,
  type ReleaseRequest, type PackRef } from "./platform-content-release-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
function protectedBytes(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    need(st.isFile() && st.uid === 0 && st.nlink === 1 && (st.mode & 0o077) === 0 && st.size <= 1024 * 1024, "ROOT_PRIVATE_INPUT_REQUIRED");
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function loadPack(ref: PackRef): Buffer {
  need(typeof ref.path === "string" && !ref.path.includes("\\") && !ref.path.includes("\0")
    && !ref.path.startsWith("/") && ref.path.split("/").every(x => x !== "" && x !== "." && x !== ".."), "PACK_PATH_INVALID");
  let path = ROOT;
  for (const part of ref.path.split("/")) { path = join(path, part); need(!lstatSync(path).isSymbolicLink(), "PACK_SYMLINK"); }
  need(lstatSync(path).isFile() && lstatSync(path).size <= 32 * 1024 * 1024, "PACK_FILE_INVALID");
  return readFileSync(path);
}
async function main() {
  const [mode, requestPath, requestSha, source, backupPath, backupSha] = process.argv.slice(2);
  need(["preflight", "apply", "readback"].includes(mode ?? "") && requestPath && requestSha && source, "CLI_INPUT");
  need(process.argv.length === (mode === "apply" ? 8 : 6), "CLI_ARGUMENT_COUNT");
  need(process.getuid?.() === 0, "ROOT_EXECUTION_REQUIRED");
  const raw = protectedBytes(requestPath); need(sha(raw) === requestSha, "REQUEST_BYTES_CHANGED");
  const request = JSON.parse(raw.toString("utf8")) as ReleaseRequest;
  need(request.sourceRevision === source && request.expectedDatabase === "workspacex_a1cb_20261006", "CN_TARGET_IDENTITY");
  const input = verifyInputs(request, requestSha, loadPack);
  if (mode === "apply") {
    need(backupPath && backupSha, "BACKUP_REQUIRED");
    const bytes = protectedBytes(backupPath); need(sha(bytes) === backupSha, "BACKUP_BYTES_CHANGED");
    const backup = JSON.parse(bytes.toString("utf8"));
    need(backup.kind === "cn-content-backup-observation-v1" && backup.sourceRevision === source
      && backup.requestSha256 === requestSha && backup.dbInstanceId === "pgm-uf6rg214cp381l49"
      && backup.database === request.expectedDatabase && backup.status === "Success"
      && backup.beforeStateSha256 === request.beforeStateSha256 && typeof backup.snapshotId === "string"
      && /^[0-9]+$/.test(backup.snapshotId) && backup.independentlyObserved === true, "BACKUP_NOT_ACCEPTED");
    const completed = Date.parse(backup.completedAt);
    need(Number.isFinite(completed) && completed <= Date.now() && Date.now() - completed <= 3600000, "BACKUP_NOT_FRESH");
  }
  const config = migrationConfig(); need(config.database === request.expectedDatabase, "CONNECTION_DATABASE_MISMATCH");
  // Keep provider diagnostics out of the single machine receipt; the exit code
  // and bounded classification below are the external operation result.
  const db = new PgDatabase(config, { info() {}, error() {}, drain: () => [] });
  try {
    let receipt: unknown;
    if (mode === "apply") receipt = await synchronize(db, input);
    else receipt = await db.withTenant(toOrgId("org-platform"), async s => {
      await s.query("SET TRANSACTION READ ONLY");
      const identity = await s.query<{ database: string }>("SELECT current_database() AS database");
      need(identity.rows[0]?.database === request.expectedDatabase, "DATABASE_IDENTITY");
      if (mode === "readback") return readback(db, s, input);
      const actual = await stateDigest(s);
      if (actual !== request.beforeStateSha256) process.exitCode = 20;
      return { beforeStateSha256: actual, expectedBeforeStateMatches: actual === request.beforeStateSha256,
        sourceInputsVerified: true, productionWrites: false, executionReady: false };
    });
    console.log(JSON.stringify({ kind: "cn-platform-content-release-receipt-v1", mode,
      sourceRevision: source, requestSha256: requestSha, observedAt: new Date().toISOString(), receipt }));
  } finally { await db.close(); }
}

main().catch(error => {
  console.log(JSON.stringify({ kind: "cn-platform-content-release-receipt-v1", status: "REJECTED_OR_UNKNOWN",
    code: error instanceof ContentReleaseRejected ? error.code : "EXECUTION_FAILED",
    automaticRetry: false, fullBusinessAcceptance: false }));
  process.exitCode = error instanceof ContentReleaseRejected ? 20 : 70;
});
