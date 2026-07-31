/**
 * I-P42 🔴 —— `artifact_bindings.step_id` 首次获得外键（复合：`(step_id, project_id, org_id)
 * → agenda_segments (id, workshop_id, org_id)`）。孤儿绑定（指向不存在的环节，或指向
 * **别的工作坊**的环节）从此不可能存在。
 *
 * 这条外键让 phase-00 已签核但此前不可评估的两个失败码（`STEP_CLOSED` /
 * `STEP_REJECTS_ARTIFACT_TYPE`）第一次有判据可读——本文件只断言外键本身，
 * 两个失败码的应用层判定不在本 feature 范围内（见 F120）。
 *
 * 四条断言：
 *   ① 结构：外键确实存在，且引用的是 agenda_segments
 *   ② 反证：指向不存在的环节 —— 23503
 *   ③ 正向：指向存在且同工作坊的环节 —— 成功（否则「所有绑定都拒绝」的实现也全绿）
 *   ④ 反证：指向存在但**属于另一个工作坊**的环节 —— 23503（复合外键的全部理由）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f118-org-fk";

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

async function seedSegment(orgId: string, workshopId: string, id: string): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
       VALUES ($1,$2,$3,0,'seg',15,'pending')`,
      [id, orgId, workshopId],
    ),
  );
}

/** 不经 materializeArtifact：本文件只需要一行满足 artifacts 表约束的 artifact，无需真实存储。 */
async function seedArtifact(orgId: string, id: string, workshopId: string): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
       VALUES ($1,$2,$3,'upload',$4,'u-f118',false)`,
      [id, orgId, workshopId, `artifact ${id}`],
    ),
  );
}

async function insertBinding(
  orgId: string,
  projectId: string,
  artifactId: string,
  stepId: string,
  id: string,
): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO artifact_bindings (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',NULL,'u-f118')`,
      [id, orgId, artifactId, projectId, stepId],
    ),
  );
}

describe("I-P42: 结构断言 —— artifact_bindings 首次获得指向 agenda_segments 的外键", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  }, 180_000);

  it("复合外键存在，且引用表是 agenda_segments", async () => {
    const rows = await asOwner(async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS def
           FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
          WHERE t.relname = 'artifact_bindings' AND con.contype = 'f'
            AND con.conname = 'artifact_bindings_segment_fkey'`,
      );
      return r.rows;
    });
    expect(rows.length, "artifact_bindings_segment_fkey 外键不存在").toBe(1);
    expect(rows[0]!.def).toMatch(/REFERENCES agenda_segments/);
    expect(rows[0]!.def).toMatch(/step_id/);
  });
});

describe("I-P42: 孤儿绑定不可能存在（双向：拒绝孤儿，也放行合法引用）", () => {
  const W1 = `${ORG}-w1`;
  const W2 = `${ORG}-w2`;

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
    await seedSegment(ORG, W1, "f118fk-seg-w1");
    await seedSegment(ORG, W2, "f118fk-seg-w2");
    await seedArtifact(ORG, "f118fk-art-1", W1);
    await seedArtifact(ORG, "f118fk-art-2", W1);
    await seedArtifact(ORG, "f118fk-art-3", W1);
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG);
  });

  it("反证：step_id 指向不存在的环节 —— 外键拒绝（23503）", async () => {
    const code = await sqlstateOf(() =>
      insertBinding(ORG, W1, "f118fk-art-1", "no-such-segment", "f118fk-bind-ghost"),
    );
    expect(code).toBe("23503");
  });

  it("正向：step_id 指向存在且属于同一工作坊的环节 —— 成功", async () => {
    await insertBinding(ORG, W1, "f118fk-art-1", "f118fk-seg-w1", "f118fk-bind-ok");
    const row = await asOwner(async (c) => {
      const r = await c.query<{ step_id: string }>(
        "SELECT step_id FROM artifact_bindings WHERE id = $1",
        ["f118fk-bind-ok"],
      );
      return r.rows[0];
    });
    expect(row?.step_id).toBe("f118fk-seg-w1");
  });

  it("反证：step_id 指向存在但属于另一个工作坊的环节 —— 复合外键拒绝（23503）", async () => {
    // project_id = W1，但 f118fk-seg-w2 属于 W2 —— 单列外键会放行这一条（环节确实存在），
    // 只有复合外键（要求 workshop_id 也匹配 project_id）才会拒绝它。这正是本表 I-P42
    // 的复合外键要防的洞：三视角首屏据此渲染出一个属于别的工作坊的环节标题。
    const code = await sqlstateOf(() =>
      insertBinding(ORG, W1, "f118fk-art-2", "f118fk-seg-w2", "f118fk-bind-cross"),
    );
    expect(code).toBe("23503");
  });

  it("反向反证：同一个环节在自己的工作坊里仍然可以被再次引用（外键不是把这条环节锁死了）", async () => {
    await insertBinding(ORG, W2, "f118fk-art-3", "f118fk-seg-w2", "f118fk-bind-w2-ok");
    const row = await asOwner(async (c) => {
      const r = await c.query<{ step_id: string; project_id: string }>(
        "SELECT step_id, project_id FROM artifact_bindings WHERE id = $1",
        ["f118fk-bind-w2-ok"],
      );
      return r.rows[0];
    });
    expect(row).toEqual({ step_id: "f118fk-seg-w2", project_id: W2 });
  });
});
