/**
 * F80 —— `project_id` 可空 + **两种权限投影**（uc-6-0 R3 / V1 / V2 / V6，domain.md I-31）。
 *
 * ## 这个文件为什么两条路径都测，而不是只测「无项目」那条
 *
 * I-31 只写了 `projectId IS NULL` 的那一半，于是最省事的实现是
 * 「无项目 ⇒ 创建者+协作者；其余 ⇒ 谁都能看」，它能让 I-31 的全部断言变绿。
 * 反过来，只测「有项目」那条，则一个 `WHERE org_id = $1` 的实现就够了。
 * 两条路径**各自都能被一个错误的实现满足**，所以两条都在这里，
 * 而且每条都同时断言「该看见的看得见」与「不该看见的看不见」——
 * 只断言后者的话，一个 `USING (false)` 完美通过。
 *
 * ## 同一条规则被写了两次，这里让两次对撞
 *
 * `domain/interview/scope.ts` 的 `canRead` 是纯函数版本，
 * `VISIBILITY_PREDICATE` 是 SQL 版本。两份声明就是本项目栽过五次的那种漂移。
 * 收敛不掉（一个要在进程里判、一个要在数据库里过滤），所以退而求其次：
 * **用同一组样本同时喂给两边并逐条比对**（见最后一个 describe）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { interview as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { resetInterviews, seedInterview } from "../support/interview-db";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { listInterviews } from "../../src/application/interview/list-interviews";
import { getInterview } from "../../src/application/interview/get-interview";
import { NoInterviewAccessError, ScopeNotVisibleError } from "../../src/application/interview/errors";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { canRead, projectionFor, scopeVisibleTo } from "../../src/domain/interview/scope";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f80-proj";
const PROJECT = "proj-f80-a";
const OTHER_PROJECT = "proj-f80-b";

const CREATOR = "u-f80-creator";
const COLLAB = "u-f80-collab";
const MEMBER = "u-f80-member"; // PROJECT 的成员，但不是任何访谈的创建者/协作者
const OUTSIDER = "u-f80-outsider"; // 同组织，但既不在项目里也不是协作者
const LEAD = "u-f80-lead"; // OTHER_PROJECT 的负责人（isHost）—— R5 的重点被告

/** 独立访谈（project_id IS NULL）。第一种投影。 */
const SOLO = "itv-f80-solo";
/** 项目内访谈。第二种投影。 */
const IN_PROJECT = "itv-f80-in-project";
/** 别的项目里的访谈。用来证明「项目成员」不是「任意项目的成员」。 */
const IN_OTHER = "itv-f80-in-other";
/** 独立访谈 + 显式协作者。 */
const SOLO_SHARED = "itv-f80-solo-shared";

const ALL = [SOLO, IN_PROJECT, IN_OTHER, SOLO_SHARED];

let db: PgDatabase;
let repo: PgInterviewScopeRepository;
let prov: PgProvenanceRepository;

const scopeNone = { kind: "none" as const, projectId: null, researchProjectId: null };
const scopeProject = (p: string) => ({ kind: "project" as const, projectId: p, researchProjectId: null });

/** 判定 id 工厂：`discloseDecided` 要一个 decisionId，用生产同一个实现。 */
const decisions = new UuidDecisionIdFactory();
const deps = () => ({ repo, decisions });
const getDeps = () => ({ repo, provenance: prov, decisions });

async function list(viewer: string, scope: Parameters<typeof listInterviews>[1]["scope"]) {
  return listInterviews(deps(), { orgId: toOrgId(ORG), viewerUserId: viewer, scope });
}
const idsOf = (r: Awaited<ReturnType<typeof list>>) => r.items.map((i) => i.interviewId).sort();

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgInterviewScopeRepository(db);
  prov = new PgProvenanceRepository(db);
  // 同上：hookTimeout 默认 10s，而这个 hook 要拉起容器并跑全部迁移。
}, 120_000);

afterAll(async () => {
  await resetInterviews(ORG, ALL);
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetInterviews(ORG, ALL);
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  // 同一组织里的**第二个**项目。`seedOrg` 一次只建一个，而「项目成员身份不外溢到别的项目」
  // 这条断言必须有两个项目才成立。
  //
  // ⚠ 走 app 角色而不是 owner：与 db.ts 的 fixture 纪律一致 —— owner 写入会绕过
  //   `WITH CHECK`，于是断言建立在生产永远写不出来的数据上。
  // ⚠ `kind` 必须显式给（F116 / 迁移 0018 把它设成 NOT NULL 且无默认）。
  //   这一行原本是 `INSERT INTO projects (id, org_id, name)`，rebase 到含 F116 的 main 之后
  //   当场红 —— F116 的注释逐字写着「『我忘了说这是三类中的哪一类』不得被静默写入」，
  //   这条断言就是它想拦的那种调用方。
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,$4)", [
      OTHER_PROJECT, ORG, "other", "workshop",
    ]),
  );
  for (const u of [CREATOR, COLLAB, MEMBER, OUTSIDER, LEAD]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  }
  await addProjectMember(ORG, PROJECT, CREATOR, "facilitator", null);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", fx.groups.g1!);
  // LEAD 是**另一个**项目的负责人。R5：项目负责人不因职位自动获得跨项目/无项目访谈的读权。
  await addProjectMember(ORG, OTHER_PROJECT, LEAD, "facilitator", null, true);

  await seedInterview({ orgId: ORG, id: SOLO, createdBy: CREATOR, projectId: null });
  await seedInterview({ orgId: ORG, id: SOLO_SHARED, createdBy: CREATOR, projectId: null, collaborators: [COLLAB] });
  await seedInterview({ orgId: ORG, id: IN_PROJECT, createdBy: CREATOR, projectId: PROJECT });
  await seedInterview({ orgId: ORG, id: IN_OTHER, createdBy: LEAD, projectId: OTHER_PROJECT });
  // ⚠ 与 beforeAll 同因：hookTimeout 默认 10s，而这个 hook 要重建一整个组织的 fixture
  // （每次 asApp 各开一条连接）。并行跑整套 64 个文件时必然超，症状是「测试被 skip」。
}, 60_000);

/* ───────────────────────── 存储层：这一列真的可空 ───────────────────────── */

describe("project_id 是可空的，而且「无项目」是一等状态", () => {
  it("列定义里 project_id 是 NULLABLE —— 若哪天被改成 NOT NULL，这里第一个红", async () => {
    // 断言 catalog 而不是「插入 NULL 没报错」：后者在列被改成 NOT NULL 之后
    // 会以 fixture 报错的形式失败，错误信息指向 fixture，而不是指向这条被违反的设计决定。
    const r = await asOwner((c) =>
      c.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'interview_sessions' AND column_name = 'project_id'`,
      ),
    );
    expect(r.rows[0]?.is_nullable, "project_id 变成 NOT NULL 会让 6.1/6.2/6.5/6.7 全返工").toBe("YES");
  });

  it("source_kind 的 CHECK 与契约枚举逐成员相等（不是长度相等）", async () => {
    const r = await asOwner((c) =>
      c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'interview_sessions_source_kind_check'`,
      ),
    );
    const def = r.rows[0]?.def ?? "";
    expect(def, "约束不存在 —— 这条断言会空转").not.toBe("");
    for (const k of C.InterviewSourceKind.options) expect(def).toContain(`'${k}'`);
    // 反向：CHECK 里不许出现契约没有的成员。只查「契约的都在」的话，
    // 一个多出 'synthetic' 的 CHECK 完美通过。
    const inCheck = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect([...new Set(inCheck)].sort()).toEqual([...C.InterviewSourceKind.options].sort());
  });
});

/* ───────────────── 第一种投影：project_id IS NULL ───────────────── */

describe("投影 ①：project_id 为空 ⇒ 创建者 + 显式协作者，仅此两者（I-31）", () => {
  it("投影判定本身是被声明的，不是恰好成立的", () => {
    expect(projectionFor(null)).toBe("creator-and-collaborators");
    expect(projectionFor(PROJECT)).toBe("creator-collaborators-and-project-members");
  });

  it("创建者看得见自己的两场独立访谈", async () => {
    expect(idsOf(await list(CREATOR, scopeNone))).toEqual([SOLO, SOLO_SHARED].sort());
  });

  it("显式协作者只看得见被显式共享的那一场，看不见另一场", async () => {
    // 后半句是关键：一个「有任意协作关系就全看」的实现会让前半句通过。
    expect(idsOf(await list(COLLAB, scopeNone))).toEqual([SOLO_SHARED]);
  });

  it("同组织的非协作者一场都看不见 —— 「不因无项目而全组织可见」", async () => {
    const r = await list(OUTSIDER, scopeNone);
    expect(r.items).toEqual([]);
    // 空态语义：本范围确实没有（有权看这个档位、只是没有内容），
    // 与「无权查看本范围」是两种不同的响应（V7）。
    expect(r.emptyBecauseNoData).toBe(true);
  });

  it("项目成员身份不外溢到无项目访谈：MEMBER 在 PROJECT 里，仍看不见 CREATOR 的独立访谈", async () => {
    expect(idsOf(await list(MEMBER, scopeNone))).toEqual([]);
  });

  it("另一个项目的负责人（isHost）同样看不见（R5：不因职位自动获得读权）", async () => {
    expect(idsOf(await list(LEAD, scopeNone))).toEqual([]);
  });

  it("按 ID 直读：非协作者被拒", async () => {
    await expect(
      getInterview(getDeps(), { orgId: toOrgId(ORG), viewerUserId: OUTSIDER, interviewId: SOLO }),
    ).rejects.toBeInstanceOf(NoInterviewAccessError);
  });

  it("...而创建者与显式协作者读得到 —— 隔离，不是瘫痪", async () => {
    for (const u of [CREATOR, COLLAB]) {
      const got = await getInterview(getDeps(), {
        orgId: toOrgId(ORG), viewerUserId: u, interviewId: SOLO_SHARED,
      });
      expect(got.interviewId).toBe(SOLO_SHARED);
      expect(got.scope).toEqual({ kind: "none", projectId: null, researchProjectId: null });
    }
  });

  it("拒绝写审计，且「不存在的 id」与「无权的 id」产生同一种审计与同一种拒绝", async () => {
    const before = (await prov.query(toOrgId(ORG), { types: ["unauthorized-attempt"] })).events.length;
    await expect(
      getInterview(getDeps(), { orgId: toOrgId(ORG), viewerUserId: OUTSIDER, interviewId: SOLO }),
    ).rejects.toBeInstanceOf(NoInterviewAccessError);
    await expect(
      getInterview(getDeps(), { orgId: toOrgId(ORG), viewerUserId: OUTSIDER, interviewId: "itv-does-not-exist" }),
    ).rejects.toBeInstanceOf(NoInterviewAccessError);

    const page = await prov.query(toOrgId(ORG), { types: ["unauthorized-attempt"], actorId: OUTSIDER });
    expect(page.events.length - before).toBe(2);
    const seen = page.events.map((e) => e.detail.interviewId).sort();
    expect(seen).toEqual([SOLO, "itv-does-not-exist"].sort());
    for (const e of page.events) {
      expect(e.detail.action).toBe("getInterview");
      expect(e.detail.reasonCode).toBe("NO_INTERVIEW_ACCESS");
    }
  });
});

/* ───────────────── 第二种投影：project_id 非空 ───────────────── */

describe("投影 ②：project_id 非空 ⇒ 再并上该项目成员（是并集，不是替换）", () => {
  it("项目成员看得见项目内访谈", async () => {
    expect(idsOf(await list(MEMBER, scopeProject(PROJECT)))).toEqual([IN_PROJECT]);
  });

  it("创建者即使不是项目成员也仍看得见 —— 并集的另一半", async () => {
    // COLLAB 不在 PROJECT 里。把他造成 SOLO_PROJ 的创建者，断言他照样读得到。
    await seedInterview({ orgId: ORG, id: "itv-f80-tmp", createdBy: COLLAB, projectId: PROJECT });
    try {
      const got = await getInterview(getDeps(), {
        orgId: toOrgId(ORG), viewerUserId: COLLAB, interviewId: "itv-f80-tmp",
      });
      expect(got.interviewId).toBe("itv-f80-tmp");
    } finally {
      await resetInterviews(ORG, ["itv-f80-tmp"]);
    }
  });

  it("别的项目的成员看不见 —— 「项目成员」不等于「任意项目的成员」", async () => {
    // LEAD 是 OTHER_PROJECT 的负责人；他按 ID 直读 PROJECT 的访谈必须被拒。
    await expect(
      getInterview(getDeps(), { orgId: toOrgId(ORG), viewerUserId: LEAD, interviewId: IN_PROJECT }),
    ).rejects.toBeInstanceOf(NoInterviewAccessError);
  });

  it("非该项目成员请求该项目档位 ⇒ SCOPE_NOT_VISIBLE（档位不显示，不是显示后空列表）", async () => {
    await expect(list(OUTSIDER, scopeProject(PROJECT))).rejects.toBeInstanceOf(ScopeNotVisibleError);
    // 而成员请求同一档位是正常的 —— 否则一个恒抛的实现也能通过上一行。
    await expect(list(MEMBER, scopeProject(PROJECT))).resolves.toBeTruthy();
  });
});

/* ───────────────── 两个档位的集合不相交（V1）───────────────── */

describe("V1：「某项目」与「不属于任何项目」两次的集合不相交，且计数可复现", () => {
  it("同一个人在两个档位拿到的 id 集合交集为空", async () => {
    const inProject = new Set(idsOf(await list(CREATOR, scopeProject(PROJECT))));
    const none = new Set(idsOf(await list(CREATOR, scopeNone)));
    expect(inProject.size, "档位为空则不相交是空对空").toBeGreaterThan(0);
    expect(none.size).toBeGreaterThan(0);
    expect([...inProject].filter((x) => none.has(x))).toEqual([]);
  });

  it("counts 是真人 / 虚拟两个独立字段，且统计的是过滤后的集合（D-25 / V5）", async () => {
    await seedInterview({ orgId: ORG, id: "itv-f80-virt", createdBy: CREATOR, projectId: null, sourceKind: "virtual" });
    try {
      const mine = await list(CREATOR, scopeNone);
      expect(mine.counts).toEqual({ human: 2, virtual: 1 });
      // 同一批数据，换一个无权的人看：counts 必须跟着变成 0/0，
      // 而不是「行过滤了、统计还是全量」—— 那种实现会把「这个组织有多少场访谈」漏给任何人。
      const theirs = await list(OUTSIDER, scopeNone);
      expect(theirs.counts).toEqual({ human: 0, virtual: 0 });
    } finally {
      await resetInterviews(ORG, ["itv-f80-virt"]);
    }
  });
});

/* ─────────── 纯函数版规则 与 SQL 版规则 必须同义 ─────────── */

describe("同一条规则的两次声明必须对撞得上（canRead ⟺ VISIBILITY_PREDICATE）", () => {
  it("六个 (访谈, 看的人) 组合上，纯函数判定与数据库返回逐条一致", async () => {
    const collabsOf: Record<string, string[]> = {
      [SOLO]: [], [SOLO_SHARED]: [COLLAB], [IN_PROJECT]: [], [IN_OTHER]: [],
    };
    const createdByOf: Record<string, string> = {
      [SOLO]: CREATOR, [SOLO_SHARED]: CREATOR, [IN_PROJECT]: CREATOR, [IN_OTHER]: LEAD,
    };
    const projectOf: Record<string, string | null> = {
      [SOLO]: null, [SOLO_SHARED]: null, [IN_PROJECT]: PROJECT, [IN_OTHER]: OTHER_PROJECT,
    };

    let checked = 0;
    for (const viewer of [CREATOR, COLLAB, MEMBER, OUTSIDER, LEAD]) {
      const projectIds = await repo.projectIdsOf(toOrgId(ORG), viewer);
      for (const itv of ALL) {
        const pure = canRead(
          {
            projectId: projectOf[itv]!,
            createdBy: createdByOf[itv]!,
            isExplicitCollaborator: collabsOf[itv]!.includes(viewer),
          },
          { userId: viewer, projectIds },
        );
        const fromDb = (await repo.findVisibleById(toOrgId(ORG), viewer, itv)) !== null;
        expect(fromDb, `${viewer} × ${itv}: 纯函数说 ${pure}，数据库说 ${fromDb}`).toBe(pure);
        checked++;
      }
    }
    expect(checked, "循环没跑 —— 这条断言会空转").toBe(20);
  });

  it("scopeVisibleTo 与 SCOPE_NOT_VISIBLE 的实际抛出一致", async () => {
    for (const viewer of [MEMBER, OUTSIDER]) {
      const projectIds = await repo.projectIdsOf(toOrgId(ORG), viewer);
      const pure = scopeVisibleTo(scopeProject(PROJECT), { userId: viewer, projectIds });
      const actual = await list(viewer, scopeProject(PROJECT)).then(() => true, () => false);
      expect(actual).toBe(pure);
    }
  });
});
