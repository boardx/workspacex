/**
 * #4366：迁移前的扩展版本预检（`age` ≥ 1.6.0、`vector` ≥ 0.8.0，唯一出处见
 * src/infrastructure/db/kg-extension-preflight.ts）。不达标 ⇒ 非零退出，stderr 一行一个扩展说明原因；
 * 输出只有扩展名与版本号，不含连接串或密码。连接变量与 migrate-cli 相同（migration 身份）。
 *
 *   node --import tsx apps/api/scripts/kg-extension-preflight.ts
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import {
  checkKgExtensions, explainKgExtensionFindings, KG_EXTENSION_PREFLIGHT_SQL, type AvailableExtensionRow,
} from "../src/infrastructure/db/kg-extension-preflight";

let client: pg.Client | undefined;
try {
  client = new pg.Client(migrationConfig());
  await client.connect();
  const findings = checkKgExtensions((await client.query<AvailableExtensionRow>(KG_EXTENSION_PREFLIGHT_SQL)).rows);
  const problem = explainKgExtensionFindings(findings);
  console.log(JSON.stringify({ ok: problem === null, extensions: findings }));
  if (problem !== null) {
    console.error(problem);
    process.exitCode = 1;
  }
} catch {
  console.error(JSON.stringify({ ok: false, reason: "kg_extension_preflight_unavailable" }));
  process.exitCode = 1;
} finally {
  await client?.end();
}
