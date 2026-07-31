/**
 * I-P34 ⚠ —— **一个 `projects` 行至多属于一个子类型**，由数据库保证。
 *
 * ## 为什么这条需要一个判据，而不是「大家都小心」
 *
 * 「子表 PK = FK 到 `projects.id`」是超类型建模的标准手法，它保证的是
 * *每张子表*对同一个 id 至多一行。三张子表互相不知道对方，所以
 *
 *     INSERT INTO workshops(id)         VALUES ('p1');
 *     INSERT INTO research_projects(id) VALUES ('p1');   -- 纯 PK+FK 下两条都合法
 *
 * 判据是**判别列 + 复合外键**（U-9 裁 A，纯声明式）：子表的 `kind` 被 CHECK 钉死为常量，
 * 复合外键要求 `(id, kind)` 在 `projects` 里存在 ⇒ 只有 `kind='workshop'` 的容器
 * 能有 `workshops` 子行；三张表的常量两两不同 ⇒ 同一个 id 不可能同时满足两张的外键。
 *
 * ## 三条反证，逐条对应 domain.md §一之三第 2 小节
 *
 *   ① 互斥真的生效        给 kind='workshop' 的容器插 research_projects 行 → 外键冲突
 *   ② 不是「谁都插不进去」  同一容器插第二条 workshops 行 → **主键**冲突（与 ① 可区分）
 *   ③ 判别列不是摆设       改容器的 kind → 被复合外键拒绝
 *
 * ⚠ 缺 ② 时，一个「三张子表全部只读」的实现两条反证都会绿。所以断言的不是
 *   「INSERT 失败」，而是**失败的 SQLSTATE**：23503（外键）vs 23505（唯一/主键）。
 *
 * 另外两条：
 *   · I-P36  三张新表自动进 RLS 网（catalog 推导的租户审计判 ok，不是 exempt）
 *   · 子行的 org_id 必须与容器的 org_id 一致（否则子行会出现在**另一个租户**的视野里）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project } from "@repo/contracts";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f116-org";
const ORG_OTHER = "f116-org-other";

const SUBTYPE_TABLE: Record<string, string> = {
  workshop: "workshops",
  research_project: "research_projects",
  user_insight: "user_insights",
};

/** 拿到 PostgreSQL 的 SQLSTATE。断言「失败了」不够——两种失败必须可区分。 */
async function sqlstateOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (e) {
    return (e as { code?: string }).code ?? `NO_CODE:${String(e)}`;
  }
}

async function seedContainer(orgId: string, id: string, kind: string): Promise<void> {
  await asApp(orgId, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,$4)", [
      id,
      orgId,
      `container ${id}`,
      kind,
    ]),
  );
}

describe("I-P34: 三类容器落库，且至多属于一个子类型", () => {
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

  it("正向：三类各建一个容器 + 对应子行，三条 INSERT 都成功", async () => {
    // 非空转的前提：契约的三值闭集就是这里遍历的三类，加第四类会让本条自动扩张。
    expect(project.ProjectKind.options.length).toBe(3);

    for (const kind of project.ProjectKind.options) {
      const id = `${ORG}-ok-${kind}`;
      await seedContainer(ORG, id, kind);
      await asApp(ORG, (c) =>
        c.query(`INSERT INTO ${SUBTYPE_TABLE[kind]} (id, org_id) VALUES ($1,$2)`, [id, ORG]),
      );
      const rows = await asApp(ORG, async (c) =>
        (await c.query(`SELECT id, kind FROM ${SUBTYPE_TABLE[kind]} WHERE id = $1`, [id])).rows,
      );
      expect(rows).toEqual([{ id, kind }]);
    }
  });

  it("反证 ①：给 kind='workshop' 的容器插 research_projects 行 —— 外键冲突（23503）", async () => {
    const id = `${ORG}-x1`;
    await seedContainer(ORG, id, "workshop");
    await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG]));

    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query("INSERT INTO research_projects (id, org_id) VALUES ($1,$2)", [id, ORG]),
      ),
    );
    // 23503 = foreign_key_violation。是**数据库**拒绝的，不是应用层——
    // 应用层的拒绝到第二个调用方为止。
    expect(code).toBe("23503");
  });

  it("反证 ②：同一容器插第二条 workshops 行 —— 主键冲突（23505），与 ① 可区分", async () => {
    // ⚠ 这一条是整组反证的支点。只有 ① 时，一个「三张子表全部只读」（例如
    //   忘了 GRANT INSERT，或建了一条拒绝一切的策略）的实现两条都绿。
    const id = `${ORG}-x1`; // ① 已经给它建过 workshops 子行
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG])),
    );
    expect(code).toBe("23505"); // unique_violation ≠ 23503
  });

  it("反证 ③：把已有子行的容器 kind 改掉 —— 被复合外键拒绝（23503）", async () => {
    const id = `${ORG}-x1`;
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query("UPDATE projects SET kind = 'research_project' WHERE id = $1", [id]),
      ),
    );
    // 没有这条，kind 就是一个「写进去没人用」的列：改掉它，workshops 子行还在，
    // 而「这个容器是工作坊」这句话已经不成立了。
    expect(code).toBe("23503");

    // 反向（防「谁都改不动」）：没有子行的容器，改 kind 是允许的。
    const free = `${ORG}-free`;
    await seedContainer(ORG, free, "workshop");
    await asApp(ORG, (c) =>
      c.query("UPDATE projects SET kind = 'user_insight' WHERE id = $1", [free]),
    );
    const k = await asApp(ORG, async (c) =>
      (await c.query<{ kind: string }>("SELECT kind FROM projects WHERE id = $1", [free])).rows[0]
        ?.kind,
    );
    expect(k).toBe("user_insight");
  });

  it("kind 不在三值闭集内 —— CHECK 拒绝（23514），且不是外键先报错", async () => {
    const code = await sqlstateOf(() => seedContainer(ORG, `${ORG}-bad`, "delivery"));
    expect(code).toBe("23514");
  });

  it("孤儿子行不可能存在：没有容器行时插子行被外键拒绝", async () => {
    const code = await sqlstateOf(() =>
      asApp(ORG, (c) =>
        c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [`${ORG}-ghost`, ORG]),
      ),
    );
    expect(code).toBe("23503");
  });

  it("子行的 org_id 必须与容器的 org_id 一致 —— 否则它会出现在另一个租户的视野里", async () => {
    // 光有 org_id → organizations 的单列外键只能保证「指向某个存在的组织」。
    // 不一致时 RLS 会按子行自己的 org_id 放行，那是一个真实的跨租户洞，
    // 而「表在租户审计里判 ok」那条断言完全看不见它。
    const id = `${ORG}-orgmix`;
    await seedContainer(ORG, id, "workshop");
    const code = await sqlstateOf(() =>
      asOwner((c) =>
        // 以 owner 身份写：RLS 的 WITH CHECK 会先把跨租户写拦掉，那样测到的是 RLS
        // 而不是这条外键。owner 绕过 RLS，剩下的拒绝只可能来自约束本身。
        c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG_OTHER]),
      ),
    );
    expect(code).toBe("23503");
  });

  it("删除容器带走子行（ON DELETE CASCADE），且不留孤儿", async () => {
    const id = `${ORG}-del`;
    await seedContainer(ORG, id, "user_insight");
    await asApp(ORG, (c) =>
      c.query("INSERT INTO user_insights (id, org_id) VALUES ($1,$2)", [id, ORG]),
    );
    await asOwner((c) => c.query("DELETE FROM projects WHERE id = $1", [id]));
    const left = await asOwner(async (c) =>
      Number((await c.query("SELECT count(*)::int AS n FROM user_insights WHERE id = $1", [id]))
        .rows[0].n),
    );
    expect(left).toBe(0);
  });
});

describe("I-P36: 三张子类型表自动进 RLS 网", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  }, 180_000);

  it("catalog 推导的租户审计把三张表都判成 ok（不是 exempt，也不是缺策略）", async () => {
    const verdicts = await asOwner(async (c) => {
      const r = await c.query<{ table_name: string; verdict: string }>(
        "SELECT table_name, verdict FROM kernel_tenant_table_audit()",
      );
      return Object.fromEntries(r.rows.map((x) => [x.table_name, x.verdict]));
    });

    // 非空转：审计确实扫到了 schema。判空时下面三条会因为 undefined 报错而不是绿，
    // 但那种红读起来像「表不存在」，所以先把这条摆出来。
    expect(Object.keys(verdicts).length).toBeGreaterThan(20);

    for (const t of ["workshops", "research_projects", "user_insights"]) {
      expect(verdicts[t], `${t} 不在租户审计里 —— 它没有 org_id？`).toBeDefined();
      expect(verdicts[t], `${t} 的裁定是 ${verdicts[t]}，不是 ok`).toBe("ok");
    }
  });

  it("F22 的三条冻结策略也覆盖了三张新表（0018 末尾那一句 SELECT 的全部理由）", async () => {
    // ⚠ 2026-08-01（F124）：这三张表现在**同时**挂着两组独立的 RESTRICTIVE 冻结——
    // F22 的组织停用冻结（`*_org_frozen_*`，0018 末尾调用 `kernel_apply_org_freeze_policies()`
    // 时装上）与 F124 的容器归档冻结（`*_project_archived_*`，`20260801120000_f124_*.sql`
    // 末尾调用 `kernel_apply_project_archive_policies()` 时装上）。按策略名前缀分开计数，
    // 而不是简单把总数从 3 改成 6：分开计数才断言得出「两组冻结**各自**齐全」，
    // 一个只装对了其中一组、总数却凑巧等于 6 的实现不会被这条断言放过。
    const counts = await asOwner(async (c) => {
      const r = await c.query<{ tablename: string; prefix: string; n: string }>(
        `SELECT tablename,
                CASE WHEN policyname LIKE '%\\_org\\_frozen\\_%' ESCAPE '\\' THEN 'org_frozen'
                     WHEN policyname LIKE '%\\_project\\_archived\\_%' ESCAPE '\\' THEN 'project_archived'
                     ELSE 'other' END AS prefix,
                count(*)::text AS n
           FROM pg_policies
          WHERE schemaname='public' AND permissive='RESTRICTIVE'
            AND tablename IN ('workshops','research_projects','user_insights')
          GROUP BY tablename, prefix`,
      );
      const out: Record<string, Record<string, number>> = {};
      for (const row of r.rows) {
        (out[row.tablename] ??= {})[row.prefix] = Number(row.n);
      }
      return out;
    });
    for (const t of ["workshops", "research_projects", "user_insights"]) {
      // 每组各自 INSERT / UPDATE / DELETE 三条。少了任一行,新库上这张表就少了对应
      // 那一组冻结,而各自的既有断言依旧全绿——它们测的是当时已存在的那一组。
      expect(counts[t]?.org_frozen, `${t} 的 F22 组织冻结策略数`).toBe(3);
      expect(counts[t]?.project_archived, `${t} 的 F124 容器归档冻结策略数`).toBe(3);
      expect(counts[t]?.other, `${t} 出现了未预期的第三组 RESTRICTIVE 策略`).toBeUndefined();
    }
  });
});
