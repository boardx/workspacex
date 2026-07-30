/**
 * F80 —— **服务端过滤**（uc-6-0 V2：「列表不返回再前端过滤」）。
 *
 * ## 断言的对象是响应载荷里没有那条数据，不是界面上没渲染它
 *
 * 「前端不显示」是一个**看不见的失败**：界面正确、单测全绿、只有抓包能看见
 * 越权数据已经过了网线。所以这个文件里没有一处断言看的是渲染结果：
 *
 *   ① HTTP 层：把响应体当**字节**看，断言里面根本不含那个 id（`text/body/序列化`三处都查）。
 *   ② 数据库层：包一层记录所有查询结果的 `DatabasePort`，断言**从数据库回到进程里的行**
 *      就已经不含它。这条杀掉的是「SELECT 全量 → 在 JS 里 filter」——
 *      那种实现能完美通过 ①，因为响应体确实干净，而越权数据只是在内存里过了一遭。
 *
 * ## 反证
 *
 * 把 `pg-interview-scope-repository.ts` 的 `VISIBILITY_PREDICATE` 从三处 WHERE 里去掉，
 * 本文件必须当场红。文件末尾还有一个**常驻**的反证：用一个故意不过滤的仓储替身跑同一组断言，
 * 断言它们确实会失败 —— 一条永远不可能红的断言与没有断言是同一回事。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember,
  addProjectMember,
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
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import type {
  GuardedInterviewRow,
  InterviewScopeRepository,
  ListVisibleInput,
  ListVisiblePage,
  StoredInterviewRow,
} from "../../src/application/interview/ports";
import { guard } from "../../src/application/security/permission-filter";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f80-leak";
const PROJECT = "proj-f80-leak";

const CREATOR = "u-f80l-creator";
const OUTSIDER = "u-f80l-outsider";

/** 机密：一场独立访谈，标题本身就是内容 —— 泄露标题与泄露 id 一样是泄露。 */
const SECRET = "itv-f80l-secret";
const SECRET_TITLE = "并购尽调访谈 · 目标方 CFO";
/** OUTSIDER 自己的一场，用来证明过滤不是「一律返回空」。 */
const OWN = "itv-f80l-own";
const ALL = [SECRET, OWN];

let db: PgDatabase;
let repo: PgInterviewScopeRepository;
let app: NestExpressApplication;
let BASE: string;

const scopeNone = { kind: "none" as const, projectId: null, researchProjectId: null };
const decisions = new UuidDecisionIdFactory();

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgInterviewScopeRepository(db);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  // ⚠ 显式 hook 超时。vitest.config 里只提高了 testTimeout，hookTimeout 仍是默认 10s，
  // 而这个 hook 要拉起容器、跑迁移、再启一个 Nest 应用 —— 在负载高的机器上必然超。
  // 症状是「9 个 test 全部 skipped」，看起来像测试没写，而不是像超时。
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetInterviews(ORG, ALL);
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetInterviews(ORG, ALL);
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  for (const u of [CREATOR, OUTSIDER]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, CREATOR, "facilitator", null);
  await seedInterview({ orgId: ORG, id: SECRET, createdBy: CREATOR, projectId: null, title: SECRET_TITLE });
  await seedInterview({ orgId: ORG, id: OWN, createdBy: OUTSIDER, projectId: null, title: "我自己的" });
  // ⚠ 与 beforeAll 同因：hookTimeout 默认 10s，而这个 hook 要重建一整个组织的 fixture
  // （每次 asApp 各开一条连接）。并行跑整套 64 个文件时必然超，症状是「测试被 skip」。
}, 60_000);

const auth = (u: string) => ({ "x-kernel-test-principal": `${u}:${ORG}` });

/* ─────────────────── ① 抓包：响应体里根本没有那条数据 ─────────────────── */

describe("HTTP 响应载荷里不含越权数据（不是前端不渲染）", () => {
  it("GET /interviews?scopeKind=none —— 非协作者拿到的字节里没有别人的 id，也没有别人的标题", async () => {
    const res = await fetch(`${BASE}/interviews?scopeKind=none`, { headers: auth(OUTSIDER) });
    expect(res.status).toBe(200);
    const raw = await res.text();

    // 看字节，不看解析后的结构：一个把越权行塞进 `_debug` 或 `meta` 的实现，
    // 在 `body.items` 上断言会全绿。
    expect(raw, "响应体里出现了越权访谈的 id").not.toContain(SECRET);
    expect(raw, "响应体里出现了越权访谈的标题 —— 标题也是内容").not.toContain(SECRET_TITLE);

    // 非空性：过滤不是「一律返回空」。没有这半句，`USING (false)` 完美通过上面两行。
    const body = JSON.parse(raw) as { items: { interviewId: string }[]; counts: { human: number; virtual: number } };
    expect(body.items.map((i) => i.interviewId)).toEqual([OWN]);
    expect(body.counts).toEqual({ human: 1, virtual: 0 });
  });

  it("创建者自己请求同一路由时，那条数据是**在**的 —— 证明上一条测的是过滤而不是接口坏了", async () => {
    const raw = await (await fetch(`${BASE}/interviews?scopeKind=none`, { headers: auth(CREATOR) })).text();
    expect(raw).toContain(SECRET);
    expect(raw).toContain(SECRET_TITLE);
  });

  it("GET /interviews/:id —— 无权与不存在的响应除 traceId 外逐字节相同（uc-6-0/E3 的枚举探测面）", async () => {
    const denied = await fetch(`${BASE}/interviews/${SECRET}`, { headers: auth(OUTSIDER) });
    const absent = await fetch(`${BASE}/interviews/itv-f80l-nope`, { headers: auth(OUTSIDER) });
    expect(denied.status).toBe(absent.status);
    expect(denied.status).toBe(404);
    const a = await denied.text();
    const b = await absent.text();

    // ⚠ 「逐字节」在这个系统里做不到，而且**不应该**做到：
    // `all-exceptions.filter.ts` 给每个响应带一个必须存在的 `traceId`（I-11，可运维性）。
    // 它是每请求随机的，与被寻址的资源无关，所以它不是探测口 —— 但它让原文的
    // 「响应体必须逐字节不可区分」在字面上不可满足。这里把它遮掉再比，
    // 并**顺带断言两个 traceId 确实不同** —— 否则「遮掉后相等」也可能是因为它是个常量，
    // 那才是真的可疑。
    const mask = (s: string) => s.replace(/"traceId":"[^"]+"/, '"traceId":"<masked>"');
    const traceOf = (s: string) => /"traceId":"([^"]+)"/.exec(s)?.[1];
    expect(traceOf(a)).toBeTruthy();
    expect(traceOf(a)).not.toBe(traceOf(b));
    expect(mask(a)).toBe(mask(b));

    // 这份共同的响应体里不含被寻址的那个 id，也不含任何 reasonCode ——
    // 一个「顺手把 NO_INTERVIEW_ACCESS 带上」的改动会让上面那句相等仍然成立，
    // 却把「无权」与「不存在」重新变成两种可分辨的东西（无权才有码）。
    expect(a).not.toContain(SECRET);
    expect(a).not.toContain("reasonCode");
  });

  it("无权的项目档位不返回 404 而是 403 + SCOPE_NOT_VISIBLE（档位不显示 ≠ 项目不存在）", async () => {
    const res = await fetch(`${BASE}/interviews?scopeKind=project&projectId=${PROJECT}`, {
      headers: auth(OUTSIDER),
    });
    expect(res.status).toBe(403);
    const raw = await res.text();
    expect(raw).toContain("SCOPE_NOT_VISIBLE");
    expect(raw).not.toContain(SECRET);
  });
});

/* ────────── ② 数据库回来的行里就已经没有它（杀掉「取全量再 JS 过滤」）────────── */

/** 记录每一次查询**返回**了什么的 `DatabasePort` 装饰器。 */
class RecordingDatabase implements DatabasePort {
  readonly seen: { sql: string; rows: unknown[] }[] = [];
  constructor(private readonly inner: DatabasePort) {}
  private wrap(s: TenantSession): TenantSession {
    const seen = this.seen;
    return {
      async query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
        const r = await s.query<R>(sql, params);
        seen.push({ sql, rows: r.rows as unknown[] });
        return r;
      },
    };
  }
  withTenant<T>(orgId: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inner.withTenant(orgId, (s) => fn(this.wrap(s)));
  }
  withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inner.withoutTenant((s) => fn(this.wrap(s)));
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe("过滤发生在数据库里，不是在进程里", () => {
  it("整个 listInterviews 期间，从数据库回到进程的所有行中都不含越权访谈", async () => {
    const rec = new RecordingDatabase(db);
    const spied = new PgInterviewScopeRepository(rec);
    const out = await listInterviews(
      { repo: spied, decisions },
      { orgId: toOrgId(ORG), viewerUserId: OUTSIDER, scope: scopeNone },
    );
    expect(out.items.map((i) => i.interviewId)).toEqual([OWN]);

    expect(rec.seen.length, "一次查询都没记到 —— 这条断言会空转").toBeGreaterThan(0);
    const dump = JSON.stringify(rec.seen.map((q) => q.rows));
    expect(dump, "越权行被 SELECT 回了进程里，只是没进响应体 —— 那不是服务端过滤").not.toContain(SECRET);
    expect(dump).not.toContain(SECRET_TITLE);
  });

  it("...同一段监听在创建者身上确实看得到那条行 —— 证明监听器本身没瞎", async () => {
    const rec = new RecordingDatabase(db);
    const spied = new PgInterviewScopeRepository(rec);
    await listInterviews({ repo: spied, decisions }, { orgId: toOrgId(ORG), viewerUserId: CREATOR, scope: scopeNone });
    expect(JSON.stringify(rec.seen.map((q) => q.rows))).toContain(SECRET);
  });
});

/* ─────────────────────── ③ 常驻反证 ─────────────────────── */

/**
 * 一个**故意不过滤**的仓储：它就是「先取全量，可见性交给上层」那种实现。
 *
 * `truthfulFacts` 决定它撒不撒谎：
 * · `true`  —— SQL 层坏了，但每一行仍带着真实的判定事实。第二层判定应当把越权行扣下。
 * · `false` —— 两层都坏了（事实被伪造成「你就是创建者」）。这时越权数据真的会流出去，
 *              用来证明上面那些断言**确实会红** —— 一条永远不可能红的断言与没有断言是同一回事。
 */
class UnfilteredRepository implements InterviewScopeRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly truthfulFacts: boolean,
    private readonly viewerUserId: string,
  ) {}
  async listVisible(input: ListVisibleInput): Promise<ListVisiblePage> {
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{
        id: string; title: string; source_kind: string; project_id: string | null;
        research_project_id: string | null; tags: string[]; archived: boolean; created_by: string;
      }>(
        `SELECT id, title, source_kind, project_id, research_project_id, tags, archived, created_by
           FROM interview_sessions WHERE org_id = $1 AND project_id IS NULL
                                     AND research_project_id IS NULL`,
        [input.orgId],
      );
      const rows: GuardedInterviewRow[] = r.rows.map((x) => ({
        item: guard<StoredInterviewRow>(
          { kind: "interview", id: x.id },
          {
            interviewId: x.id, title: x.title, sourceKind: x.source_kind as "human" | "virtual",
            projectId: x.project_id, researchProjectId: x.research_project_id,
            tags: x.tags, archived: x.archived, whenAt: null,
          },
        ),
        facts: {
          projectId: x.project_id,
          // 撒谎的那一档：把每一行都说成「看的人自己建的」。
          createdBy: this.truthfulFacts ? x.created_by : this.viewerUserId,
          isExplicitCollaborator: false,
        },
      }));
      const kinds = r.rows.map((x) => x.source_kind);
      return {
        rows,
        nextCursor: null,
        counts: {
          human: kinds.filter((k) => k === "human").length,
          virtual: kinds.filter((k) => k === "virtual").length,
        },
      };
    });
  }
  async findVisibleById(): Promise<GuardedInterviewRow | null> {
    return null;
  }
  async projectIdsOf(): Promise<string[]> {
    return [];
  }
  async orgMembershipOf(): Promise<{ orgRole: string | null; teamId: string | null }> {
    return { orgRole: "consultant", teamId: null };
  }
}

describe("反证：把过滤拿掉，断言必须红（且证明第二层判定不是摆设）", () => {
  it("只有 SQL 层坏掉时，进程里的第二次判定把越权行扣下 —— 纵深防御真的在工作", async () => {
    const out = await listInterviews(
      { repo: new UnfilteredRepository(db, true, OUTSIDER), decisions },
      { orgId: toOrgId(ORG), viewerUserId: OUTSIDER, scope: scopeNone },
    );
    // 仓储返回了两行（它不过滤），但只有一行被解封。
    expect(out.items.map((i) => i.interviewId)).toEqual([OWN]);
    expect(JSON.stringify(out)).not.toContain(SECRET_TITLE);
  });

  it("两层都坏掉时，越权访谈确实流出去 —— 所以上面那些断言是有牙齿的", async () => {
    const out = await listInterviews(
      { repo: new UnfilteredRepository(db, false, OUTSIDER), decisions },
      { orgId: toOrgId(ORG), viewerUserId: OUTSIDER, scope: scopeNone },
    );
    const ids = out.items.map((i) => i.interviewId).sort();
    expect(ids).toEqual([OWN, SECRET].sort());
    // 逐字重放真实断言的形状，并断言它**失败**。
    expect(() => expect(ids).toEqual([OWN])).toThrow();
    expect(() => expect(JSON.stringify(out)).not.toContain(SECRET)).toThrow();
  });

  it("counts 走的是 SQL 侧，第二层判定救不了它 —— 不过滤的仓储会泄露「这个组织有多少场访谈」", async () => {
    // ⚠ 这是一条**真实的残留风险**，不是测试技巧：`counts` 由仓储在过滤后的集合上统计，
    // 进程侧的第二次判定只作用于**行**，不重算计数。所以 counts 的正确性完全押在
    // SQL 谓词上 —— 而这正是「服务端过滤」这条主张必须成立的原因之一。
    const out = await listInterviews(
      { repo: new UnfilteredRepository(db, true, OUTSIDER), decisions },
      { orgId: toOrgId(ORG), viewerUserId: OUTSIDER, scope: scopeNone },
    );
    expect(out.counts).toEqual({ human: 2, virtual: 0 });
    expect(() => expect(out.counts).toEqual({ human: 1, virtual: 0 })).toThrow();
  });
});
