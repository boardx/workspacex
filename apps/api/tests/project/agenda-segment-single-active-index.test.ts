/**
 * I-P44 🔴 —— 同一工作坊内 `active` 的议程环节至多一个，且这是**数据库层的部分唯一索引**
 * 而不是应用层「先查后写」。
 *
 * 「议程环节状态是三视角首屏的唯一驱动源」这句话只有这样才是可断言的：先查后写在
 * 并发下就是那条空转的门（两个请求都读到「当前没有 active」，都写成功，静默出现两条
 * active，没有任何东西报警）。
 *
 * 四条断言，两个方向都要有：
 *   ① 索引确实存在，且谓词与列都对（结构断言）
 *   ② 并发把两条环节同时置为 active —— 恰好一条成功，另一条拿到 23505
 *   ③ 反证：索引不是「谁都不能 active」——正常单条 INSERT 能成功
 *   ④ 索引的范围是「同一工作坊」——另一个工作坊里已有一条 active 不挡这边
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f118-org-active-idx";

async function sqlstateOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (e) {
    return (e as { code?: string }).code ?? `NO_CODE:${String(e)}`;
  }
}

async function seedWorkshop(orgId: string, id: string): Promise<void> {
  await asApp(orgId, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
      id,
      orgId,
      `workshop ${id}`,
    ]),
  );
  await asApp(orgId, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, orgId]));
}

async function insertSegment(
  orgId: string,
  workshopId: string,
  id: string,
  state: string,
): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
       VALUES ($1,$2,$3,0,'seg',15,$4)`,
      [id, orgId, workshopId, state],
    ),
  );
}

describe("I-P44: 结构断言 —— 部分唯一索引确实存在，谓词与列都对", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  }, 180_000);

  it("agenda_segments_one_active_per_workshop 是 UNIQUE，列是 workshop_id，谓词是 state='active'", async () => {
    const def = await asOwner(async (c) => {
      const r = await c.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'agenda_segments' AND indexname = 'agenda_segments_one_active_per_workshop'`,
      );
      return r.rows[0]?.indexdef ?? "";
    });
    expect(def, "索引不存在").not.toBe("");
    expect(def).toMatch(/UNIQUE INDEX/i);
    expect(def).toMatch(/\(workshop_id\)/);
    expect(def).toMatch(/WHERE \(state = 'active'::text\)/);
  });
});

describe("I-P44: 并发下恰好一条成功，且不是「谁都不能 active」", () => {
  const W1 = `${ORG}-w1`;
  const W2 = `${ORG}-w2`;
  let raceWinner = "";

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    await resetOrgs(ORG);
    await asApp(ORG, (c) =>
      c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [
        ORG,
        `org ${ORG}`,
      ]),
    );
    await seedWorkshop(ORG, W1);
    await seedWorkshop(ORG, W2);
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG);
  });

  it("反证：一条 pending 环节能被正常置为 active —— 不是索引把一切都挡住了", async () => {
    await insertSegment(ORG, W1, "f118a-first", "pending");
    await asApp(ORG, (c) =>
      c.query("UPDATE agenda_segments SET state = 'active' WHERE id = $1", ["f118a-first"]),
    );
    const state = await asOwner(async (c) => {
      const r = await c.query<{ state: string }>(
        "SELECT state FROM agenda_segments WHERE id = $1",
        ["f118a-first"],
      );
      return r.rows[0]?.state;
    });
    expect(state).toBe("active");
  });

  it("并发把两条环节同时推成 active —— 恰好一条成功，另一条拿到 23505", async () => {
    await insertSegment(ORG, W1, "f118a-race-a", "pending");
    await insertSegment(ORG, W1, "f118a-race-b", "pending");

    // ⚠ allSettled，不是先起两个 promise 再逐个 await：两个都可能 reject，
    // 而只在同一时刻创建的两个 promise 才能同时挂上 handler（同 kernel 反证的教训）。
    const results = await Promise.allSettled([
      asApp(ORG, (c) =>
        c.query("UPDATE agenda_segments SET state = 'active' WHERE id = $1", ["f118a-race-a"]),
      ),
      asApp(ORG, (c) =>
        c.query("UPDATE agenda_segments SET state = 'active' WHERE id = $1", ["f118a-race-b"]),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // 恰好一条成功 —— 不是「都成功」（索引没生效）也不是「都失败」（索引挡了一切）。
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "23505" });

    const activeRows = await asOwner(async (c) => {
      const r = await c.query<{ id: string }>(
        "SELECT id FROM agenda_segments WHERE workshop_id = $1 AND state = 'active'",
        [W1],
      );
      return r.rows;
    });
    expect(activeRows.length).toBe(1);
    // 哪一条赢了并发是不确定的（数据库序列化两个 UPDATE 的顺序不受本文件控制），
    // 记下赢家供后续测试关闭它——不能假设固定是 race-a 或 race-b。
    raceWinner = activeRows[0]!.id;
  });

  it("另一个工作坊已有一条 active，不挡这边的第一条 active —— 索引的范围是「同一工作坊」", async () => {
    // W1 此时已经有一条 active（上一条测试留下的）。W2 从未有过 active。
    await insertSegment(ORG, W2, "f118a-w2-first", "pending");
    await asApp(ORG, (c) =>
      c.query("UPDATE agenda_segments SET state = 'active' WHERE id = $1", ["f118a-w2-first"]),
    );
    const state = await asOwner(async (c) => {
      const r = await c.query<{ state: string }>(
        "SELECT state FROM agenda_segments WHERE id = $1",
        ["f118a-w2-first"],
      );
      return r.rows[0]?.state;
    });
    expect(state).toBe("active");
  });

  it("闭合已有的 active 之后，同一工作坊能推进出新的 active（索引只挡并发，不挡先后）", async () => {
    expect(raceWinner, "上一条测试没有记录到赢家").not.toBe("");
    await asApp(ORG, (c) =>
      c.query(
        "UPDATE agenda_segments SET state = 'closed' WHERE id = $1 AND workshop_id = $2",
        [raceWinner, W1],
      ),
    );
    await insertSegment(ORG, W1, "f118a-next", "pending");
    await asApp(ORG, (c) =>
      c.query("UPDATE agenda_segments SET state = 'active' WHERE id = $1", ["f118a-next"]),
    );
    const state = await asOwner(async (c) => {
      const r = await c.query<{ state: string }>(
        "SELECT state FROM agenda_segments WHERE id = $1",
        ["f118a-next"],
      );
      return r.rows[0]?.state;
    });
    expect(state).toBe("active");
  });
});
