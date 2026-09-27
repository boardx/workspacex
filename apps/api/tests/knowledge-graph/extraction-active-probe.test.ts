/**
 * issue #4279 —— `assertExtractionActive` 探针与 F15 记忆体验评测种子。
 *
 * #4239 之后 `seedOrg` 给每个测试组织写一条显式 `enabled = false` 的抽取开关；评测种子
 * （`scripts/seed-kg-experience-eval.ts`）用 `seedOrg` 却没重新打开，评测环境从此一条记忆都
 * 形不成，而没有任何东西变红。这里钉住两件事：
 *   1. 探针真能分辨「开 / 关」（关着必须抛，开着必须过），且什么都不留下；
 *   2. 评测种子在 `seedOrg` 之后打开抽取，并用探针自证——删掉任何一步，这里就红。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { assertExtractionActive, enableExtraction } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4279-probe";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

async function leftovers(): Promise<number> {
  return asOwner(async (c) => {
    const q = await c.query("SELECT count(*)::int AS n FROM kg_extraction_queue WHERE org_id = $1", [ORG]);
    const t = await c.query("SELECT count(*)::int AS n FROM chat_threads WHERE org_id = $1", [ORG]);
    return (q.rows[0].n as number) + (t.rows[0].n as number);
  });
}

describe("assertExtractionActive：发一条（回滚掉的）消息，看它排不排队", () => {
  it("seedOrg 之后（显式关）探针抛错——这正是 #4279 的评测环境", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
    await expect(assertExtractionActive(ORG)).rejects.toThrow(/not active for org org-kg-i4279-probe/);
    expect(await leftovers()).toBe(0);
  });

  it("enableExtraction 之后探针通过，且不留下会话、消息或队列行", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
    await enableExtraction(ORG);
    await expect(assertExtractionActive(ORG)).resolves.toBeUndefined();
    expect(await leftovers()).toBe(0);
  });
});

describe("F15 评测种子在 seedOrg 之后打开抽取，并用探针自证", () => {
  const seed = readFileSync(
    fileURLToPath(new URL("../../scripts/seed-kg-experience-eval.ts", import.meta.url)), "utf8",
  ).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("顺序：seedOrg → enableExtraction(orgId) → assertExtractionActive(orgId)", () => {
    const at = (needle: string) => seed.indexOf(needle);
    expect(at("await seedOrg("), "种子不再调用 seedOrg——这条检查需要重看").toBeGreaterThan(-1);
    expect(at("await enableExtraction(orgId)")).toBeGreaterThan(at("await seedOrg("));
    expect(at("await assertExtractionActive(orgId)")).toBeGreaterThan(at("await enableExtraction(orgId)"));
  });
});
