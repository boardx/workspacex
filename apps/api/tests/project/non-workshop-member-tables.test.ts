/**
 * F128 U-1 裁 B —— 研究项目 / 用户洞察各有自己的成员表，`role ∈ {owner, collaborator}`，
 * **不复用**工作坊四角色（facilitator/groupLead/member/observer）。
 *
 * ## 反证覆盖 domain.md I-P6（四角色只属工作坊）与本迁移的判据
 *
 *   ① 正向：两类容器各自能写 owner / collaborator 两档，且落在**各自**的表里
 *   ② `role` 不在两值闭集内 —— CHECK 拒绝（23514），不是外键先报错
 *   ③ 一人一档：同一 (user_id, project_id) 写第二行 —— 主键冲突（23505），与②可区分
 *   ④ 项目角色词（facilitator 等）不是这张表的合法值 —— 证明「不复用」不是文档一句话，
 *      是这张表物理上装不下那四个词
 *   ⑤ 表不是互通的：把研究项目的容器 id 当作 project_id 写进 user_insight_members
 *      （或反之）—— 外键拒绝（23503），因为复合外键分别钉死在各自的子类型表上
 *   ⑥ 跨租户 org_id 不一致 —— 外键拒绝（23503），同 F116 三张子表的同一条判据
 *
 * 另外断言 `packages/contracts/src/project.ts` 的 `NonWorkshopMemberRole` 与本迁移的
 * CHECK 逐字同值——闭集只应该有一份事实源，这里断言的是「没有第二份」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project } from "@repo/contracts";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f128-org";
const ORG_OTHER = "f128-org-other";

const CONTAINER: Record<"research_project" | "user_insight", { subtype: string; members: string }> = {
  research_project: { subtype: "research_projects", members: "research_project_members" },
  user_insight: { subtype: "user_insights", members: "user_insight_members" },
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
  kind: "research_project" | "user_insight",
): Promise<void> {
  await asApp(orgId, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,$4)", [
      id,
      orgId,
      `container ${id}`,
      kind,
    ]);
    await c.query(`INSERT INTO ${CONTAINER[kind].subtype} (id, org_id) VALUES ($1,$2)`, [id, orgId]);
  });
}

describe("F128 non-workshop-member-tables", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    await resetOrgs(ORG, ORG_OTHER);
    for (const orgId of [ORG, ORG_OTHER]) {
      await asApp(orgId, (c) =>
        c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [
          orgId,
          `org ${orgId}`,
        ]),
      );
    }
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG, ORG_OTHER);
  });

  it("契约单源：NonWorkshopMemberRole 恰好两值，且是 owner/collaborator（不是本迁移自造的第二份事实）", () => {
    expect(project.NonWorkshopMemberRole.options).toEqual(["owner", "collaborator"]);
  });

  it("正向：两类容器各自写 owner / collaborator，落在各自的表里", async () => {
    for (const kind of ["research_project", "user_insight"] as const) {
      const id = `${ORG}-ok-${kind}`;
      await seedContainer(ORG, id, kind);
      const { members } = CONTAINER[kind];
      await asApp(ORG, (c) =>
        c.query(`INSERT INTO ${members} (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'owner')`, [
          `u-${kind}-owner`,
          id,
          ORG,
        ]),
      );
      await asApp(ORG, (c) =>
        c.query(`INSERT INTO ${members} (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'collaborator')`, [
          `u-${kind}-collab`,
          id,
          ORG,
        ]),
      );
      const rows = await asApp(ORG, async (c) =>
        (
          await c.query<{ user_id: string; role: string }>(
            `SELECT user_id, role FROM ${members} WHERE project_id = $1 ORDER BY user_id`,
            [id],
          )
        ).rows,
      );
      expect(rows).toEqual([
        { user_id: `u-${kind}-collab`, role: "collaborator" },
        { user_id: `u-${kind}-owner`, role: "owner" },
      ]);
    }
  });

  it("反证②：role 不在闭集内 —— CHECK 拒绝（23514），不是外键先报错", async () => {
    const id = `${ORG}-bad-role`;
    await seedContainer(ORG, id, "research_project");
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query(
          "INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'lead')",
          [`u-bad`, id, ORG],
        ),
      ),
    );
    expect(code).toBe("23514");
  });

  it("反证④：工作坊角色词不是合法值 —— facilitator/groupLead/member/observer 全部被 CHECK 拒绝", async () => {
    const id = `${ORG}-workshop-words`;
    await seedContainer(ORG, id, "user_insight");
    for (const workshopRole of ["facilitator", "groupLead", "member", "observer"]) {
      const code = await sqlstateOf(() =>
        asApp(ORG, (c) =>
          c.query(
            "INSERT INTO user_insight_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,$4)",
            [`u-${workshopRole}`, id, ORG, workshopRole],
          ),
        ),
      );
      expect(code, `role='${workshopRole}' 应当被拒绝`).toBe("23514");
    }
  });

  it("反证③：一人一档 —— 同一 (user_id, project_id) 写第二行是主键冲突（23505），与②可区分", async () => {
    const id = `${ORG}-dup`;
    await seedContainer(ORG, id, "research_project");
    await asApp(ORG, (c) =>
      c.query(
        "INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'owner')",
        ["u-dup", id, ORG],
      ),
    );
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query(
          "INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'collaborator')",
          ["u-dup", id, ORG],
        ),
      ),
    );
    expect(code).toBe("23505");
  });

  it("反证⑤：两张成员表互不相通 —— 用 user_insight 的容器 id 写 research_project_members 被外键拒绝（23503）", async () => {
    const uiId = `${ORG}-cross-ui`;
    await seedContainer(ORG, uiId, "user_insight");
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query(
          "INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'owner')",
          ["u-cross", uiId, ORG],
        ),
      ),
    );
    expect(code).toBe("23503");

    const rpId = `${ORG}-cross-rp`;
    await seedContainer(ORG, rpId, "research_project");
    const code2 = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query(
          "INSERT INTO user_insight_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'owner')",
          ["u-cross2", rpId, ORG],
        ),
      ),
    );
    expect(code2).toBe("23503");
  });

  it("反证⑥：org_id 与容器所属组织不一致 —— 外键拒绝（23503），同 F116 三张子表的同一条判据", async () => {
    const id = `${ORG}-orgmix`;
    await seedContainer(ORG, id, "research_project");
    const code = await sqlstateOf(() =>
      // owner 绕过 RLS，剩下的拒绝只可能来自复合外键本身（同 subtype-exclusive-1to1 的写法）。
      asOwner((c) =>
        c.query(
          "INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'owner')",
          ["u-orgmix", id, ORG_OTHER],
        ),
      ),
    );
    expect(code).toBe("23503");
  });

  it("孤儿成员行不可能存在：容器不存在时插成员行被外键拒绝", async () => {
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query(
          "INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'owner')",
          ["u-ghost", `${ORG}-ghost`, ORG],
        ),
      ),
    );
    expect(code).toBe("23503");
  });

  it("删除容器带走成员行（ON DELETE CASCADE），且不留孤儿", async () => {
    const id = `${ORG}-del`;
    await seedContainer(ORG, id, "user_insight");
    await asApp(ORG, (c) =>
      c.query(
        "INSERT INTO user_insight_members (user_id, project_id, org_id, role) VALUES ($1,$2,$3,'owner')",
        ["u-del", id, ORG],
      ),
    );
    await asOwner((c) => c.query("DELETE FROM projects WHERE id = $1", [id]));
    const left = await asOwner(async (c) =>
      Number(
        (await c.query("SELECT count(*)::int AS n FROM user_insight_members WHERE project_id = $1", [id]))
          .rows[0].n,
      ),
    );
    expect(left).toBe(0);
  });
});

describe("F128: 两张新成员表自动进 RLS 网 + F22/F124 两组冻结", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  }, 180_000);

  it("catalog 推导的租户审计把两张表都判成 ok", async () => {
    const verdicts = await asOwner(async (c) => {
      const r = await c.query<{ table_name: string; verdict: string }>(
        "SELECT table_name, verdict FROM kernel_tenant_table_audit()",
      );
      return Object.fromEntries(r.rows.map((x) => [x.table_name, x.verdict]));
    });
    for (const t of ["research_project_members", "user_insight_members"]) {
      expect(verdicts[t], `${t} 不在租户审计里 —— 它没有 org_id？`).toBeDefined();
      expect(verdicts[t], `${t} 的裁定是 ${verdicts[t]}，不是 ok`).toBe("ok");
    }
  });

  it("F22 组织冻结 与 F124 容器归档冻结 两组各三条 RESTRICTIVE 策略都装上了", async () => {
    const counts = await asOwner(async (c) => {
      const r = await c.query<{ tablename: string; prefix: string; n: string }>(
        `SELECT tablename,
                CASE WHEN policyname LIKE '%\\_org\\_frozen\\_%' ESCAPE '\\' THEN 'org_frozen'
                     WHEN policyname LIKE '%\\_project\\_archived\\_%' ESCAPE '\\' THEN 'project_archived'
                     ELSE 'other' END AS prefix,
                count(*)::text AS n
           FROM pg_policies
          WHERE schemaname='public' AND permissive='RESTRICTIVE'
            AND tablename IN ('research_project_members','user_insight_members')
          GROUP BY tablename, prefix`,
      );
      const out: Record<string, Record<string, number>> = {};
      for (const row of r.rows) {
        (out[row.tablename] ??= {})[row.prefix] = Number(row.n);
      }
      return out;
    });
    for (const t of ["research_project_members", "user_insight_members"]) {
      expect(counts[t]?.org_frozen, `${t} 的 F22 组织冻结策略数`).toBe(3);
      expect(counts[t]?.project_archived, `${t} 的 F124 容器归档冻结策略数`).toBe(3);
    }
  });
});
