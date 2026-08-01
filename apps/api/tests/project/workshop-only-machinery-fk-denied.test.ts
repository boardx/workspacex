/**
 * F128 U-7 裁 A —— 分组（`groups`）与工作坊项目成员（`project_memberships`）是
 * **工作坊专属机件**：往一个研究项目或用户洞察容器里插分组、或写一行工作坊项目成员，
 * 必须被数据库外键直接拒绝，不是应用层某个 `if` 拦下的——不管写入路径从哪条进来都拦得住。
 *
 * ## 判据与 F116 三张 1:1 子类型表同构（U-9 裁 A 的同一手法）
 *
 * `groups` / `project_memberships` 各加一列 `kind`，CHECK 钉死为常量 `'workshop'`，
 * 复合外键 `(project_id, kind) REFERENCES projects(id, kind)` 要求「这个 project_id
 * 在 `projects` 里的那一行，kind 恰好是 workshop」。研究项目/用户洞察容器的 `projects`
 * 行 `kind` 不是 `'workshop'`，复合外键自然找不到匹配行 —— 23503，与应用层判断无关。
 *
 * ## 反证顺序，逐条对应 subtype-exclusive-1to1.test.ts 的论证形状
 *
 *   ① 正向：工作坊容器下，两张表原样可写（不破坏任何既有写入路径 —— DEFAULT 'workshop' 兜底）
 *   ② 反证：研究项目容器下插 groups / project_memberships —— 23503（外键，不是应用层拒绝）
 *   ③ 反证：用户洞察容器下同上 —— 23503
 *   ④ 判别列不是摆设：显式声明 kind='research_project' 插入 —— CHECK 拒绝（23514），
 *      与②③的 23503 可区分（CHECK 挡的是「值不在闭集」，FK 挡的是「值与容器不匹配」）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f128-fk-org";

const SUBTYPE_TABLE: Record<"workshop" | "research_project" | "user_insight", string> = {
  workshop: "workshops",
  research_project: "research_projects",
  user_insight: "user_insights",
};

async function sqlstateOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (e) {
    return (e as { code?: string }).code ?? `NO_CODE:${String(e)}`;
  }
}

async function seedContainer(
  orgId: string,
  id: string,
  kind: "workshop" | "research_project" | "user_insight",
): Promise<void> {
  await asApp(orgId, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,$4)", [
      id,
      orgId,
      `container ${id}`,
      kind,
    ]);
    await c.query(`INSERT INTO ${SUBTYPE_TABLE[kind]} (id, org_id) VALUES ($1,$2)`, [id, orgId]);
  });
}

describe("F128 workshop-only-machinery-fk-denied", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    await resetOrgs(ORG);
    await asApp(ORG, (c) =>
      c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
    );
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG);
  });

  it("正向：工作坊容器下，groups 与 project_memberships 原样可写（既有写入路径不受影响）", async () => {
    const id = `${ORG}-ws-ok`;
    await seedContainer(ORG, id, "workshop");

    // 既有写入路径从不传 kind —— 靠 DEFAULT 'workshop' 兜底。
    await asApp(ORG, (c) =>
      c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1,$2,$3,$4)", [
        `${id}-g1`,
        ORG,
        id,
        "g1",
      ]),
    );
    await asApp(ORG, (c) =>
      c.query(
        "INSERT INTO project_memberships (user_id, project_id, org_id, project_role) VALUES ($1,$2,$3,$4)",
        ["u-ws-member", id, ORG, "facilitator"],
      ),
    );

    const groupKind = await asApp(ORG, async (c) =>
      (await c.query<{ kind: string }>("SELECT kind FROM groups WHERE id = $1", [`${id}-g1`])).rows[0]
        ?.kind,
    );
    expect(groupKind).toBe("workshop");

    const membershipKind = await asApp(ORG, async (c) =>
      (
        await c.query<{ kind: string }>(
          "SELECT kind FROM project_memberships WHERE user_id = $1 AND project_id = $2",
          ["u-ws-member", id],
        )
      ).rows[0]?.kind,
    );
    expect(membershipKind).toBe("workshop");
  });

  it.each(["research_project", "user_insight"] as const)(
    "反证：%s 容器下插 groups —— 被复合外键拒绝（23503），不是应用层报错",
    async (kind) => {
      const id = `${ORG}-groups-${kind}`;
      await seedContainer(ORG, id, kind);
      const code = await sqlstateOf(() =>
        asApp(ORG, (c) =>
          c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1,$2,$3,$4)", [
            `${id}-g`,
            ORG,
            id,
            "g",
          ]),
        ),
      );
      expect(code).toBe("23503");
    },
  );

  it.each(["research_project", "user_insight"] as const)(
    "反证：%s 容器下插 project_memberships —— 被复合外键拒绝（23503），不是应用层报错",
    async (kind) => {
      const id = `${ORG}-pm-${kind}`;
      await seedContainer(ORG, id, kind);
      const code = await sqlstateOf(() =>
        asApp(ORG, (c) =>
          c.query(
            "INSERT INTO project_memberships (user_id, project_id, org_id, project_role) VALUES ($1,$2,$3,$4)",
            [`u-${kind}`, id, ORG, "member"],
          ),
        ),
      );
      expect(code).toBe("23503");
    },
  );

  it("判别列不是摆设：显式把 kind 声明成非 workshop 值 —— CHECK 拒绝（23514），与外键拒绝可区分", async () => {
    const id = `${ORG}-explicit-kind`;
    await seedContainer(ORG, id, "workshop");

    const groupCode = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query("INSERT INTO groups (id, org_id, project_id, name, kind) VALUES ($1,$2,$3,$4,$5)", [
          `${id}-g`,
          ORG,
          id,
          "g",
          "research_project",
        ]),
      ),
    );
    expect(groupCode).toBe("23514");

    const membershipCode = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query(
          "INSERT INTO project_memberships (user_id, project_id, org_id, project_role, kind) VALUES ($1,$2,$3,$4,$5)",
          ["u-explicit", id, ORG, "member", "user_insight"],
        ),
      ),
    );
    expect(membershipCode).toBe("23514");
  });

  it("孤儿判据不可能绕过：把已存在容器的 kind 改掉后，既有 groups/project_memberships 行的复合外键立刻不成立", async () => {
    // 反向视角的 ③：不是新写入被拒，而是既有工作坊行一旦容器 kind 改变就应当拒绝该 UPDATE
    // 本身（同 subtype-exclusive-1to1 反证③ 的形状）——防「判别列写进去没人用」。
    const id = `${ORG}-kind-change`;
    await seedContainer(ORG, id, "workshop");
    await asApp(ORG, (c) =>
      c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1,$2,$3,$4)", [
        `${id}-g`,
        ORG,
        id,
        "g",
      ]),
    );
    const code = await sqlstateOf(() =>
      asOwner((c) => c.query("UPDATE projects SET kind = 'research_project' WHERE id = $1", [id])),
    );
    expect(code).toBe("23503");
  });
});
