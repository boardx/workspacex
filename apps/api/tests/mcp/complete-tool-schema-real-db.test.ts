import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureDatabase,migrateOnce,seedOrg,resetOrgs } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { createPgMcpToolStore } from "../../src/infrastructure/mcp/pg-mcp-tool-store";
import { toContractTool } from "../../src/application/mcp/discover-tools";
const org = `org-e005-${randomUUID()}`, other = `org-e005-${randomUUID()}`;
let db: PgDatabase;
beforeAll(async () => { await ensureDatabase(); await migrateOnce();
  await seedOrg({ orgId: org,projectId: `p-${org}` }); await seedOrg({ orgId: other,projectId: `p-${other}` });
  db = new PgDatabase(appConfig()); });
afterAll(async () => { await db?.close(); await resetOrgs(org,other); });
it("WX-E005 persists complete schemas losslessly while preserving legacy absence and tenant isolation", async () => {
  const complete = toContractTool("mcp-fixture",{ name: "search",signature: "search(q)",sideEffect: "只读",description: "检索",
    inputSchema: { type: "object",properties: { q: { type: "string",enum: ["a","b"] } },required: ["q"],additionalProperties: false },
    outputSchema: { type: "object",properties: { rows: { type: "array",items: { type: "integer",minimum: 0 } } } } });
  const legacy = toContractTool("mcp-fixture",{ name: "legacy",signature: "legacy()",sideEffect: "只读" });
  await createPgMcpToolStore(db,org).replace("mcp-fixture",[complete,legacy]);
  const rows = await createPgMcpToolStore(db,org).current("mcp-fixture");
  expect(rows.find(r => r.fullName === complete.fullName)).toEqual(complete);
  expect(rows.find(r => r.fullName === legacy.fullName)).toEqual(legacy);
  expect(rows.find(r => r.fullName === legacy.fullName)).not.toHaveProperty("inputSchema");
  expect(await createPgMcpToolStore(db,other).current("mcp-fixture")).toEqual([]);
});
