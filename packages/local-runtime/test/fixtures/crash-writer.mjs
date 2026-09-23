/**
 * 崩溃恢复门的写入方：起 PGlite、不停地成批写，直到被外面 `kill -9`。
 *
 * 用真进程而不是在测试进程里跑，是因为**这道门要测的就是「进程被硬杀」**——
 * 在同一个进程里模拟不出那件事（替身产不出缺陷的形状）。
 */
import { ensureDatabaseExists, startPgliteServer } from "../../src/pglite-server.ts";
import { createRequire } from "node:module";

const require_ = createRequire(new URL("../../../../apps/api/package.json", import.meta.url));
const pg = require_("pg");

const [dataDir, portS, batchS] = process.argv.slice(2);
const port = Number(portS);
const batch = Number(batchS ?? 20);

await ensureDatabaseExists(dataDir);
await startPgliteServer({ dataDir, port, username: "postgres" });
const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "workspacex" });
await c.connect();
await c.query("CREATE TABLE IF NOT EXISTS crash_probe (id serial primary key, note text)");
process.stdout.write("WRITING\n");
let i = 0;
for (;;) {
  await c.query("BEGIN");
  for (let k = 0; k < batch; k += 1) {
    await c.query("INSERT INTO crash_probe(note) VALUES ($1)", [`row-${i}`]);
    i += 1;
  }
  await c.query("COMMIT");
  // 每一批都报，测试据此知道「被杀时至少已经提交了多少」——这是断言的下界。
  process.stdout.write(`COMMITTED ${i}\n`);
}
