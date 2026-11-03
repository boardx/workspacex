// From the repo: node evidence/local-backup-port-isolation-6196/verify-occupied-port.mjs
// An occupied historical port must not prevent the real backup/restore roundtrip.
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const sentinel = net.createServer(s => s.end("owned-sentinel\n"));
// Fail if somebody else already owns this port; never stop or adopt their listener.
await new Promise((resolve, reject) => {
  sentinel.once("error", reject);
  sentinel.listen(55492, "127.0.0.1", resolve);
});
console.log(`[6196] owned sentinel listening on55492 pid=${process.pid}`);
try {
  const child = spawn("pnpm", ["exec", "vitest", "run", "test/backup-restore-roundtrip.test.ts"], {
    cwd: fileURLToPath(new URL("../../packages/local-runtime", import.meta.url)), stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  console.log(`[6196] roundtrip exit=${code}; owned sentinel still listening=${sentinel.listening}`);
  process.exitCode = code === 0 && sentinel.listening ? 0 : 1;
} finally {
  await new Promise((resolve, reject) => sentinel.close(e => e ? reject(e) : resolve()));
  console.log("[6196] owned sentinel closed");
}
