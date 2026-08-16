/**
 * F117 ①③ —— **一条创建路径** + **两行原子写入**。
 *
 * ## 「原子」这条断言为什么必须靠故障注入
 *
 * 正向断言（建完之后两行都在）在**两次提交**的实现下同样全绿：两次提交之间那段
 * 「有容器没子类型」的中间态，在没有人崩溃的一次测试里根本不会被观察到。
 * 而 I-P34 要排除的正是那个中间态——它一旦因为进程被杀/连接断开而留下，
 * 就是一个**永久**的半成品容器，且没有任何东西会报错。
 *
 * ⇒ 所以下面有一个 `FaultyDatabase`：它放行前 N 条语句，第 N+1 条当场抛。
 *   把 N 卡在「`projects` 已写、子类型行还没写」那一刻，正确实现回滚得干干净净，
 *   两次提交的实现会留下一行孤儿容器。**两种实现在这条断言上结果不同**——
 *   这正是「非空转」的定义。
 *
 * ## 三条反证，逐条对应上面那段
 *
 *   ① 故障注入真的能让写入失败      —— 注入点在子类型行之前 ⇒ 三张表全部为空
 *   ② 注入器不是「让什么都失败」    —— 把注入点放到语句总数之外 ⇒ 创建正常成功
 *   ③ 「两个事务」的写法当场留半成品 —— 同一个注入点，换成两次 `withTenant`，
 *                                     `projects` 里**留下**一行而子类型表为空
 * 缺 ③ 时，「原子」只是一句注释；缺 ② 时，一个「永远失败」的注入器让 ① 白绿。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { project, provenance } from "@repo/contracts";
import { createProject } from "../../src/application/project/create-project";
import { ProjectError } from "../../src/application/project/errors";
import type { BlueprintReferenceRepository } from "../../src/application/project/ports";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type {
  DatabasePort,
  TenantSession,
} from "../../src/application/ports/database.port";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";
import { SUBTYPE_TABLE, SUBTYPE_TABLES } from "../../src/domain/project/subtype-tables";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f117-atomic-org";
const LEAD = "u-f117-atomic-lead";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgProjectRepository;
let identity: PgIdentityRepository;

/** 计数并在第 `failAt` 条语句上抛。⚠ 计数是**每次 withTenant 重置**的：注入点谈的是事务内的位置。 */
class FaultyDatabase implements DatabasePort {
  constructor(
    private readonly inner: DatabasePort,
    private readonly failAt: number,
  ) {}

  withTenant<T>(orgId: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    let n = 0;
    return this.inner.withTenant(orgId, (s) =>
      fn({
        query: async (sql, params) => {
          n += 1;
          if (n === this.failAt) throw new Error(`injected fault at statement ${n}`);
          return s.query(sql, params);
        },
      }),
    );
  }

  withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inner.withoutTenant(fn);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * 故意写错的实现：**两次** `withTenant` = 两次提交。
 *
 * 它存在的唯一理由是把「原子」从一句注释变成一条会红的东西：同一个注入点下，
 * 它留下一行孤儿容器，而真实实现留下零行。若哪天这两者的结果一样了，
 * 含义是 `withTenant` 不再是一个事务边界，`pg-project-repository.ts` 的整篇理由都要重审。
 */
async function createInTwoTransactions(
  database: DatabasePort,
  args: { orgId: OrgId; id: string; name: string; kind: keyof typeof SUBTYPE_TABLE },
): Promise<void> {
  await database.withTenant(args.orgId, (s) =>
    s.query(`INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,'active',$4)`, [
      args.id,
      args.orgId,
      args.name,
      args.kind,
    ]),
  );
  await database.withTenant(args.orgId, (s) =>
    s.query(`INSERT INTO ${SUBTYPE_TABLE[args.kind]} (id, org_id) VALUES ($1,$2)`, [
      args.id,
      args.orgId,
    ]),
  );
}

async function tableCounts(id: string) {
  return asApp(ORG, async (c) => {
    const out: Record<string, number> = {};
    const p = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM projects WHERE id = $1", [id]);
    out.projects = p.rows[0]!.n;
    for (const t of SUBTYPE_TABLES) {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE id = $1`, [id]);
      out[t] = r.rows[0]!.n;
    }
    const q = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM project_creation_requests WHERE project_id = $1",
      [id],
    );
    out.replay = q.rows[0]!.n;
    return out;
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db);
  repo = new PgProjectRepository(db, new UuidIdFactory());
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [
      ORG,
      `org ${ORG}`,
    ]),
  );
  await addOrgMember(ORG, LEAD, "lead", null);
  // BP-08：一条真实蓝本行，供「蓝本是可选参数」那条用例的 stub 解析绑定
  // （`blueprint_bindings.blueprint_id` 有外键，不能指向一个不存在的行）。
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO blueprints (id, org_id, name, origin, created_by) VALUES ($1,$2,$3,'blank',$4)`,
      ["bp-v1", ORG, "F117 可选参数用蓝本", LEAD],
    ),
  );
}, HOOK_TIMEOUT_MS);

/** 见同名 stub 在 `create-project-idempotent.test.ts` 的说明——本文件只需要它总是解析成功。 */
const stubBlueprintReference: BlueprintReferenceRepository = {
  resolve: async (_orgId, blueprintVersionId) => ({
    kind: "ok",
    blueprintId: blueprintVersionId,
    filledFacetKeys: [],
    tier: "custom",
  }),
};

describe("正向：一次提交写出容器行与子类型行", () => {
  it("三类各建一个，两行同 id，且**另外两张子表一行都没有**", async () => {
    // 非空转的前提：遍历的就是契约的三值闭集，加第四类会让本条自动扩张。
    expect(project.ProjectKind.options.length).toBe(3);

    for (const kind of project.ProjectKind.options) {
      const out = await createProject(
        { repo, identity },
        {
          orgId: toOrgId(ORG),
          actorId: LEAD,
          name: `容器 ${kind}`,
          kind,
          blueprintVersionId: null,
        },
      );
      expect(out.kind).toBe(kind);
      expect(out.status).toBe("active");
      expect(out.created).toBe(true);

      const counts = await tableCounts(out.id);
      expect(counts.projects).toBe(1);
      expect(counts[SUBTYPE_TABLE[kind]]).toBe(1);
      // 互斥不是靠「大家都小心」——这里把另外两张也数一遍，
      // 因为一个「三张都插」的实现在只数对应那张时全绿。
      for (const t of SUBTYPE_TABLES) {
        if (t === SUBTYPE_TABLE[kind]) continue;
        expect(counts[t], `${t} 不该有 ${out.id} 的子行`).toBe(0);
      }
      expect(counts.replay).toBe(1);
    }
  });

  it("蓝本是**可选参数**，不是第二条路径：传 null 与传一个 id 走的是同一个函数", async () => {
    // Q-1 C：空白新建 = 传 null。两次调用只有这个参数不同，都必须成功、都必须
    // 写出同样形状的两行；「空白新建」不另开接口、不写空值占位。
    const blank = await createProject(
      { repo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "同名", kind: "workshop", blueprintVersionId: null },
    );
    const fromBlueprint = await createProject(
      { repo, identity, blueprintReference: stubBlueprintReference },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "同名", kind: "workshop", blueprintVersionId: "bp-v1" },
    );

    // 反向：两者**不是**同一个容器。若指纹漏掉了蓝本参数，这里会拿到同一个 id，
    // 而「空白新建」与「按蓝本新建」就被静默地幂等成了一个。
    expect(fromBlueprint.id).not.toBe(blank.id);
    for (const id of [blank.id, fromBlueprint.id]) {
      const counts = await tableCounts(id);
      expect(counts.projects).toBe(1);
      expect(counts.workshops).toBe(1);
    }
  });
});

describe("反证：把注入点卡在两行之间", () => {
  it("① 子类型行写不下去 ⇒ 三张表**全部**没有这一行（回滚干净）", async () => {
    // 语句序：1 占指纹 · 2 INSERT projects · 3 INSERT 子类型表。卡在 3。
    const faulty = new PgProjectRepository(new FaultyDatabase(db, 3), new UuidIdFactory());
    const before = await asApp(ORG, async (c) =>
      Number((await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [ORG])).rows[0]!.n),
    );

    await expect(
      createProject(
        { repo: faulty, identity },
        { orgId: toOrgId(ORG), actorId: LEAD, name: "半成品", kind: "workshop", blueprintVersionId: null },
      ),
    ).rejects.toThrow(/injected fault/);

    const after = await asApp(ORG, async (c) => ({
      projects: Number((await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [ORG])).rows[0]!.n),
      workshops: Number((await c.query("SELECT count(*)::int AS n FROM workshops WHERE org_id = $1", [ORG])).rows[0]!.n),
      replay: Number(
        (await c.query("SELECT count(*)::int AS n FROM project_creation_requests WHERE org_id = $1", [ORG]))
          .rows[0]!.n,
      ),
    }));
    // 🔴 这三条是 I-P34 的整句话：失败之后**一行都不许留**。
    //    留下 projects 那一行的实现，会让这个组织从此多一个点不进去的容器，
    //    而没有任何东西会报错。
    expect(after.projects).toBe(before);
    expect(after.workshops).toBe(0);
    expect(after.replay).toBe(0);
  });

  it("② 注入器不是「让什么都失败」：把注入点放到语句总数之外，创建正常成功", async () => {
    // 缺这一条，一个「永远抛」的注入器会让上一条白绿——而它测不到任何事务语义。
    const faulty = new PgProjectRepository(new FaultyDatabase(db, 99), new UuidIdFactory());
    const out = await createProject(
      { repo: faulty, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "注入器不挡路", kind: "user_insight", blueprintVersionId: null },
    );
    const counts = await tableCounts(out.id);
    expect(counts.projects).toBe(1);
    expect(counts.user_insights).toBe(1);
  });

  it("③ 换成「两个事务」的写法，同一个注入点**留下**一行孤儿容器", async () => {
    // 这一条是整组反证的支点：它证明 ① 的绿是「事务」挣来的，不是「插入本来就没发生」。
    const faulty = new FaultyDatabase(db, 1);
    const id = "f117-two-tx";
    await expect(
      createInTwoTransactions(faulty, { orgId: toOrgId(ORG), id, name: "两次提交", kind: "workshop" }),
    ).rejects.toThrow(/injected fault/);
    // 第一次 withTenant 的第 1 条语句被打掉 ⇒ 什么都没写。换个注入点：让第一次提交成功、
    // 第二次的第 1 条语句被打掉。FaultyDatabase 每次 withTenant 重新计数，所以要换一个实例。
    const halfway = new (class implements DatabasePort {
      private tx = 0;
      withTenant<T>(orgId: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
        this.tx += 1;
        const failThisOne = this.tx === 2;
        return db.withTenant(orgId, (s) =>
          fn({
            query: async (sql, params) => {
              if (failThisOne) throw new Error("injected fault in second transaction");
              return s.query(sql, params);
            },
          }),
        );
      }
      withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
        return db.withoutTenant(fn);
      }
      close(): Promise<void> {
        return Promise.resolve();
      }
    })();

    const id2 = "f117-two-tx-half";
    await expect(
      createInTwoTransactions(halfway, { orgId: toOrgId(ORG), id: id2, name: "两次提交", kind: "workshop" }),
    ).rejects.toThrow(/injected fault/);

    const counts = await tableCounts(id2);
    // 🔴 半成品**真的**留下了。这就是 ① 那条断言在两次提交的实现下会看见的东西。
    expect(counts.projects).toBe(1);
    expect(counts.workshops).toBe(0);
    expect(id).toBe("f117-two-tx"); // 前半段那个 id 没有被写出来
    expect((await tableCounts(id)).projects).toBe(0);
  });
});

/* ─────────────────────── 一条创建路径（不许有第二个入口） ─────────────────────── */

const API_SRC = fileURLToPath(new URL("../../src", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** 去掉注释行——注释里写着表名是**对规则的说明**，不是对规则的违反（同 lint 脚本的豁免）。 */
function codeLines(body: string): string[] {
  return body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

describe("Q-1 C：全仓恰好一条创建路径", () => {
  const files = walk(API_SRC);

  it("非空转：真的扫到了源码树", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("`INSERT INTO projects` 恰好出现在一个文件里", () => {
    const hits = files.filter((f) =>
      codeLines(readFileSync(f, "utf8")).some((l) => /INSERT\s+INTO\s+projects\b/i.test(l)),
    );
    expect(
      hits.map((f) => relative(API_SRC, f)),
      "第二个写点意味着不变量要写两遍，漏掉的那一遍不会有任何东西报警",
    ).toEqual(["infrastructure/project/pg-project-repository.ts"]);
  });

  it("创建路由恰好一条，且它的路径就是契约里的那一条", () => {
    const routes: string[] = [];
    for (const f of files) {
      for (const l of codeLines(readFileSync(f, "utf8"))) {
        const m = /@Post\(\s*"([^"]+)"/.exec(l);
        if (m === null) continue;
        const path = m[1]!;
        // 「创建容器」= **集合级** POST：路径里没有 `:` 参数段。
        // 带参数的 POST 是对一个**已存在**容器的动作（F124 的
        // `/projects/:projectId/archive` 就是），把它们算进来会让本条在下一个
        // feature 落地时无理由地变红，而那种红会被人直接改断言。
        if (path.includes(":")) continue;
        if (/projects|workshops|research-projects|user-insights/.test(path)) routes.push(path);
      }
    }
    // ⚠ 断言的是**集合**不是「包含」：`POST /workshops` 之类的第三类专用入口
    //   一出现就会落在这里，而「/projects 还在」的那种断言看不见它。
    expect(routes).toEqual([project.operations.createProject.path]);
    expect(project.operations.createProject.method).toBe("POST");
  });
});

/* ────────── 契约矛盾的钉子（KNOWN_CONTRACT_GAPS.P3）—— 半边已由 ADR-101 补上 ────────── */

describe("🔴 P3 的后半截仍未解决：枚举补齐了，create-project 还没发出 provenanceEventId", () => {
  /**
   * ## 这条断言被翻转过一次，翻转本身是它设计好的行为
   *
   * F117 写这条时，它断言那四个成员**不存在**，并在失败信息里写着
   * 「枚举一旦补上成员，本条当场红，接手的人来这里补写入」。
   * ADR-101（F32 顺带一次补齐 files / interview / project / chat 四个束的缺口）
   * 把四个成员加进了 `ProvenanceEventType` —— 于是它当场红了，**正如它被设计的那样**。
   *
   * ⚠ 红了之后的正确处置**不是删掉它**，而是把钉子挪到剩下的那半截上：
   *   · 已解决：共享枚举里现在有 `project-created` / `project-archived` /
   *     `project-unarchived` / `agenda-segment-state-changed`（ADR-101，⚠ 状态 Proposed，
   *     需人类追认；否决时这四个成员会被回退，而下面第一条断言会再次翻回红）
   *   · **未解决**：`application/project/create-project.ts` 仍然没有写这条审计、
   *     `createProject` 的响应里仍然没有 `provenanceEventId` —— 而契约要求它有
   *
   * ⇒ 两条断言，覆盖翻转的两侧。删掉任何一条都会让「还差什么」重新变成没人看见的事。
   */
  it("枚举侧已补齐（ADR-101），而写入侧还没接 —— 差的是后者", () => {
    // 契约那一侧要求这个字段。
    expect(Object.keys(project.operations.createProject.out.shape)).toContain("provenanceEventId");

    // ① 已解决的那半：四个成员现在都在。
    //
    // ⚠ 判据仍是**逐个点名**而不是正则（`admin-project-access` 含 "project" 却是 D-18 的
    //   读取留痕，不是容器生命周期）。正则会因为一个无关的名字而绿，那种绿最难发现。
    const CANDIDATES = [
      "project-created",
      "project-archived",
      "project-unarchived",
      "agenda-segment-state-changed",
    ];
    const missing = CANDIDATES.filter(
      (c) => !(provenance.ProvenanceEventType.options as readonly string[]).includes(c),
    );
    expect(
      missing,
      "ADR-101 的项目生命周期成员不见了 —— 若是 ADR-101 被人类否决而回退，" +
        "请连同 docs/adr/ADR-101 的『回退动作』一节一起处理，不要只改本断言",
    ).toEqual([]);
    // 非空转：枚举确实被读到了，而不是一个空数组让上面那条白绿。
    expect(provenance.ProvenanceEventType.options.length).toBeGreaterThan(10);
  });

  it("② 未解决的那半：createProject 仍不返回 provenanceEventId，且不编假 id", async () => {
    /**
     * 钉子挪到这里。枚举有了之后，「为什么还是没有这个字段」变成一个**只剩实现工作**的
     * 问题 —— 而没有这条断言，它会变成一个没人记得的问题。
     *
     * ⚠ 断言的是**行为**（响应里真的没有这个键），不是源码文本：一条 `grep` 断言会在
     *   有人把字段名拆成模板串时静默转绿。
     */
    const created = await createProject(
      { repo, identity },
      {
        orgId: toOrgId(ORG),
        actorId: LEAD,
        name: "P3 后半截",
        kind: "workshop",
        blueprintVersionId: null,
      },
    );
    expect(Object.keys(created)).not.toContain("provenanceEventId");
    // ...而 out 契约要求它 —— 这就是缺口本身，写成一条可执行的对账。
    expect(Object.keys(project.operations.createProject.out.shape)).toContain("provenanceEventId");
    expect(ProjectError).toBeDefined();
  });
});
