/**
 * issue #4178 —— `kg_enqueue_extraction` 触发器的两道闸门（迁移 20260925110000，
 * 闸门二的默认值由 20260926100000 改成开）：部署开关（`kg_extraction_state`）打开 AND 该组织
 * 没有显式关掉（`kg_org_extraction_settings`：没有行 = 开，`enabled = false` 的行 = 关），
 * 新消息才排进 `kg_extraction_queue`。各种组合逐条真库反证。
 *
 * ⚠ `kg_extraction_state` 是全库单例（F06 既有设计）：一旦任何并行跑的测试文件调用过
 *   `kg_extraction_enable()`，它在整次测试运行里就一直是 true——没有对应的「关」入口，
 *   关也不安全（那正是本 feature 要解决的问题之一，见迁移头注）。所以本文件只在需要
 *   「部署没能力」这个前提的用例里，用一个未提交事务临时把它设成 false、断言完就
 *   ROLLBACK（`extraction-agent.test.ts`「抽取关着时不排队」用例的同一手法：并行跑的
 *   其他测试文件看不到这一刻的「关」）；需要「部署有能力」时直接提交 `kg_extraction_enable()`——
 *   这本来就是全库共享、只增不减的状态，和其他测试文件的既有假设一致。
 * 组织级的 `kg_org_extraction_settings` 只在本文件自己的 org 下操作，`resetOrgs` 连表带级联
 * 删掉这个 org 时一并清空，不影响其他测试文件。`seedOrg` 会给测试组织写一条显式关掉的行
 * （见 `tests/support/db.ts`），要测「没有行 = 默认开」的用例用 `clearOrgSetting()` 删掉它。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addChatThread } from "../support/chat-db";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-kg-f4178-toggle";
const THREAD = "thr-kg-f4178-toggle";
let db: PgDatabase;
let seq = 0;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
});
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addChatThread({ orgId: ORG, id: THREAD, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
});

/** 组织开关落库（committed）；不动全库单例。 */
async function setOrgEnabled(enabled: boolean): Promise<void> {
  await asOwner((c) => c.query(
    `INSERT INTO kg_org_extraction_settings (org_id, enabled) VALUES ($1, $2)
       ON CONFLICT (org_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [ORG, enabled],
  ));
}

/** 删掉本组织的设置行，回到「从未设置过」——产品里一个新组织的真实初始状态。 */
async function clearOrgSetting(): Promise<void> {
  await asOwner((c) => c.query("DELETE FROM kg_org_extraction_settings WHERE org_id = $1", [ORG]));
}

/** 部署能力提交为「有」——全库共享、只增不减，和其他测试文件的既有假设一致。 */
async function enableDeployment(): Promise<void> {
  await asOwner((c) => c.query("SELECT kg_extraction_enable()"));
}

/** 一条真实消息是否被排进抽取队列（committed 路径）。 */
async function sendAndCheckQueued(): Promise<boolean> {
  const id = `m-f4178-${String(seq++)}`;
  await asApp(ORG, (c) => c.query(
    "INSERT INTO chat_messages (id, org_id, thread_id, author_kind, author_id, body) VALUES ($1, $2, $3, 'human', 'u-owner', '随便说点什么，用来判有没有排队。')",
    [id, ORG, THREAD],
  ));
  const r = await asApp(ORG, (c) => c.query("SELECT 1 FROM kg_extraction_queue WHERE message_id = $1", [id]));
  return (r.rowCount ?? 0) > 0;
}

/**
 * 「部署没能力」这个前提在一个未提交事务里临时造出来：BEGIN → 把单例设 false → 插入
 * 消息 → 查队列 → ROLLBACK。事务内看到的是「关」，但从不提交，其他并行文件看不到这一刻。
 */
async function sendUnderDeploymentOff(orgEnabledFirst: boolean): Promise<boolean> {
  const id = `m-f4178-off-${String(seq++)}`;
  return asOwner(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("UPDATE kg_extraction_state SET enabled = false");
      if (orgEnabledFirst) {
        await c.query(
          `INSERT INTO kg_org_extraction_settings (org_id, enabled) VALUES ($1, true)
             ON CONFLICT (org_id) DO UPDATE SET enabled = true`,
          [ORG],
        );
      }
      await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
      await c.query(
        "INSERT INTO chat_messages (id, org_id, thread_id, author_kind, author_id, body) VALUES ($1, $2, $3, 'human', 'u-owner', '部署没能力时说的话')",
        [id, ORG, THREAD],
      );
      const r = await c.query("SELECT 1 FROM kg_extraction_queue WHERE message_id = $1", [id]);
      return (r.rowCount ?? 0) > 0;
    } finally {
      await c.query("ROLLBACK");
    }
  });
}

describe("F4178: 记忆抽取的组织开关——两道闸门", () => {
  it("组织显式关掉、部署也没能力 ⇒ 不排队", async () => {
    expect(await sendUnderDeploymentOff(false)).toBe(false);
  });

  it("组织开了，但部署没能力 ⇒ 不排队（部署那道闸门单独拦下）", async () => {
    expect(await sendUnderDeploymentOff(true)).toBe(false);
  });

  it("部署有能力，组织从未设置过（没有行）⇒ 排队（组织开关默认开，人类指令「默认是打开的」）", async () => {
    await enableDeployment();
    await clearOrgSetting();
    expect(await sendAndCheckQueued()).toBe(true);
  });

  it("部署有能力，但组织显式关掉（enabled = false 的行）⇒ 不排队（显式关优先于默认开）", async () => {
    await enableDeployment();
    await setOrgEnabled(false);
    expect(await sendAndCheckQueued()).toBe(false);
  });

  it("组织从未设置过（没有行），但部署没能力 ⇒ 不排队（默认开不越过部署那道闸门）", async () => {
    await clearOrgSetting();
    expect(await sendUnderDeploymentOff(false)).toBe(false);
  });

  it("两道都开 ⇒ 排队", async () => {
    await enableDeployment();
    await setOrgEnabled(true);
    expect(await sendAndCheckQueued()).toBe(true);
  });

  it("来回切换：开→关→开，组织开关是可逆的（不是只能开一次的单例）", async () => {
    await enableDeployment();
    await setOrgEnabled(true);
    expect(await sendAndCheckQueued()).toBe(true);

    await setOrgEnabled(false);
    expect(await sendAndCheckQueued()).toBe(false);

    await setOrgEnabled(true);
    expect(await sendAndCheckQueued()).toBe(true);
  });
});
