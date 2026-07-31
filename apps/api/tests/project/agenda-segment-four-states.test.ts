/**
 * I-P43 —— 议程环节四态 `pending` / `active` / `closed` / `skipped`，
 * `mergedInto` 只在 `closed` / `skipped` 上可非空。
 *
 * ⚠ **不得**退化成 `started_at` / `ended_at` 时间戳：临时提权的失效条件是
 *   「流程节点不是时间点」（uc-1-4:98 逐字）。这一条本身写不成断言，但它推出的
 *   两条能写成断言：
 *
 *   ① 四态是**闭集**——CHECK 逐值等于契约 `AgendaSegmentState`，第五个值被拒绝。
 *   ② `merged_into` 是**流程节点的产物**，不是任何时刻都能填——只有 `closed` /
 *      `skipped` 允许非空，`pending` / `active` 上非空是数据损坏，必须被 CHECK 拒绝。
 *
 * 两个方向都测：断言②要挡的（终态之外非空）与断言②要放的（两个终态各自非空、
 * 以及终态上仍可为空——`closed` 不等于「一定并入了别处」）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project } from "@repo/contracts";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f118-org-states";

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
  mergedInto: string | null,
): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state, merged_into)
       VALUES ($1,$2,$3,0,'seg',15,$4,$5)`,
      [id, orgId, workshopId, state, mergedInto],
    ),
  );
}

describe("I-P43: 四态是闭集，且 CHECK 逐值等于契约枚举", () => {
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
    await seedWorkshop(ORG, `${ORG}-w1`);
    await seedWorkshop(ORG, `${ORG}-w2`);
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG);
  });

  it("contract AgendaSegmentState 恰好四值，且库里的 CHECK 逐个等于它", async () => {
    // 非空转前提：契约就是这四个值，加第五个会让本条自动扩张。
    expect(project.AgendaSegmentState.options.length).toBe(4);
    expect([...project.AgendaSegmentState.options].sort()).toEqual([
      "active",
      "closed",
      "pending",
      "skipped",
    ]);

    // ⚠ 按显式约束名精确定位，不用 LIKE 猜：`merged_into` 那条 CHECK 的表达式里
    // 同样含 `state`，一个粗糙的 `%state%ANY%` 会同时命中两条，谁排第一不确定。
    const def = await asOwner(async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS def
           FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
          WHERE t.relname = 'agenda_segments' AND con.contype = 'c'
            AND con.conname = 'agenda_segments_state_check'`,
      );
      return r.rows[0]?.def ?? "";
    });
    expect(def, "agenda_segments 上找不到 state 的 CHECK").not.toBe("");
    const inSql = [...def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]!).sort();
    expect(inSql).toEqual([...project.AgendaSegmentState.options].sort());
  });

  it("第五个值（既非四态之一）被数据库拒绝——23514，不是应用层才知道", async () => {
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
           VALUES ($1,$2,$3,0,'seg',15,'archived')`,
          ["f118s-bad", ORG, `${ORG}-w1`],
        ),
      ),
    );
    expect(code).toBe("23514");
  });

  it("四态正向：pending / active / closed / skipped 都能各自建一条", async () => {
    for (const state of project.AgendaSegmentState.options) {
      const id = `f118s-ok-${state}`;
      await insertSegment(ORG, `${ORG}-w2`, id, state, null);
      const row = await asOwner(async (c) => {
        const r = await c.query<{ state: string }>(
          "SELECT state FROM agenda_segments WHERE id = $1",
          [id],
        );
        return r.rows[0];
      });
      expect(row?.state).toBe(state);
    }
  });
});

describe("I-P43: merged_into 只在 closed / skipped 上可非空", () => {
  const W = `${ORG}-w1`;

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    // 独立的 describe 块 —— 上一个 describe 的 afterAll 已 resetOrgs(ORG)，
    // 这里必须重新建组织与工作坊，不能假设上一个 describe 留下的行还在。
    await resetOrgs(ORG);
    await asApp(ORG, (c) =>
      c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [
        ORG,
        `org ${ORG}`,
      ]),
    );
    await seedWorkshop(ORG, W);
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG);
  });

  it("反证：pending 带 merged_into —— 被 CHECK 拒绝（23514）", async () => {
    await insertSegment(ORG, W, "f118s-target-a", "closed", null);
    const code = await sqlstateOf(() =>
      insertSegment(ORG, W, "f118s-bad-pending", "pending", "f118s-target-a"),
    );
    expect(code).toBe("23514");
  });

  it("反证：active 带 merged_into —— 同样被拒绝（两个非终态都要测，不能只测一个）", async () => {
    const code = await sqlstateOf(() =>
      insertSegment(ORG, W, "f118s-bad-active", "active", "f118s-target-a"),
    );
    expect(code).toBe("23514");
  });

  it("正向：closed 带 merged_into —— 成功", async () => {
    await insertSegment(ORG, W, "f118s-target-b", "pending", null);
    await insertSegment(ORG, W, "f118s-closed-merged", "closed", "f118s-target-b");
    const row = await asOwner(async (c) => {
      const r = await c.query<{ merged_into: string }>(
        "SELECT merged_into FROM agenda_segments WHERE id = $1",
        ["f118s-closed-merged"],
      );
      return r.rows[0];
    });
    expect(row?.merged_into).toBe("f118s-target-b");
  });

  it("正向：skipped 带 merged_into —— 两个终态都要测，只测 closed 会漏 skipped", async () => {
    await insertSegment(ORG, W, "f118s-skipped-merged", "skipped", "f118s-target-b");
    const row = await asOwner(async (c) => {
      const r = await c.query<{ merged_into: string; state: string }>(
        "SELECT merged_into, state FROM agenda_segments WHERE id = $1",
        ["f118s-skipped-merged"],
      );
      return r.rows[0];
    });
    expect(row).toEqual({ merged_into: "f118s-target-b", state: "skipped" });
  });

  it("反向反证：closed 不强制带 merged_into —— 提前结束≠一定并入了别处", async () => {
    await insertSegment(ORG, W, "f118s-closed-alone", "closed", null);
    const row = await asOwner(async (c) => {
      const r = await c.query<{ merged_into: string | null }>(
        "SELECT merged_into FROM agenda_segments WHERE id = $1",
        ["f118s-closed-alone"],
      );
      return r.rows[0];
    });
    expect(row?.merged_into).toBeNull();
  });

  it("孤儿合并目标不可能存在：merged_into 指向不存在的环节被外键拒绝（23503）", async () => {
    const code = await sqlstateOf(() =>
      insertSegment(ORG, W, "f118s-ghost-merge", "closed", "no-such-segment"),
    );
    expect(code).toBe("23503");
  });
});
