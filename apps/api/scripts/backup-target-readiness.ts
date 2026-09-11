import { randomUUID, createHash } from "node:crypto";
import { createBackupStore } from "./backup-oss-adapter";

// Uses a dedicated marker outside committed backup UUIDs. Do not delete immutable
// backup objects merely to clean a deployment probe; retention policy owns this marker.
try {
  const raw = process.env.STARTER_BACKUP_TARGET_JSON;
  if (!raw) throw new Error();
  const store = await createBackupStore(raw);
  await store.assertReady();
  const key = `readiness/${randomUUID()}.txt`;
  const bytes = Buffer.from(`Workspacex backup target readiness ${randomUUID()}\n`);
  await store.putOnce(key, bytes, "text/plain");
  const read = await store.get(key);
  if (!read || !Buffer.from(read).equals(bytes)) throw new Error();
  console.log(JSON.stringify({ backupTargetVerified: true, marker: key, sha256: createHash("sha256").update(bytes).digest("hex"), cleanup: "retained-under-backup-policy" }));
} catch { console.error(JSON.stringify({ ok: false, reason: "backup_target_not_ready" })); process.exitCode = 1; }
