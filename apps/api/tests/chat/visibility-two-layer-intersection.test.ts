/**
 * F108 —— 两层交集判定、跨组、私聊三方、管理员边界（chat 束 domain.md I-1…I-9）。
 *
 * ## 这个文件里每一条拒绝都是**成对**的
 *
 * 「管理员被拒」这句话，一个把所有人都拒掉的实现同样能满足。所以每一条拒绝断言旁边
 * 都有一条必须成功的请求——同一条线程、同一个组织、换一个应该看得见的人。
 * 没有配对的拒绝断言等于没有断言。
 *
 * ## 为什么两层要各写一个方向
 *
 * 「上层给了、下层没给 ⇒ 拒」（管理员无项目角色）与「下层给了、上层没给 ⇒ 拒」
 * （有项目角色但不在组织里）是两种不同的实现错误：前者是把 orgRole 当超级权限，
 * 后者是让一条过期的 project_memberships 独自授权。只测其中一个方向，
 * 另一个方向的洞会一直绿着。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { decide } from "../../src/domain/identity/permission-decision";
import {
  CHAT_VISIBILITY_SCOPES,
  chatReadAction,
  decideThreadRead,
  type ActorFacts,
  type ThreadFacts,
} from "../../src/domain/chat/thread-visibility";
import { PROJECT_ROLES } from "../../src/domain/identity/roles";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f108";
const PROJECT = "proj-f108";
let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const readThread = (userId: string, threadId: string) =>
  fetch(`${BASE}/chat/threads/${threadId}?projectId=${PROJECT}`, { headers: as(userId) });

const auditRead = (userId: string, threadId: string, layer: "project" | "personal") =>
  fetch(`${BASE}/chat/threads/${threadId}/admin-audit-read`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ threadId, projectId: PROJECT, layer }),
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });

  // 一场项目里的五种身份。g1 是「本组」，g2 是「别组」。
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addOrgMember(ORG, "u-lead1", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-lead1", "groupLead", fx.groups.g1!);
  await addOrgMember(ORG, "u-mem1", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-mem1", "member", fx.groups.g1!);
  await addOrgMember(ORG, "u-mem1b", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-mem1b", "member", fx.groups.g1!);
  await addOrgMember(ORG, "u-lead2", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-lead2", "groupLead", fx.groups.g2!);
  await addOrgMember(ORG, "u-mem2", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-mem2", "member", fx.groups.g2!);
  await addOrgMember(ORG, "u-obs", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null);
  // 管理员：组织层齐全，**这个项目里没有任何角色**。AC1 讲的就是这个组合。
  await addOrgMember(ORG, "u-admin", "admin", fx.teams.energy!);

  await addChatThread({
    orgId: ORG, id: "t-plenary", projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac",
  });
  await addChatMessage({
    orgId: ORG, id: "m-plenary-1", threadId: "t-plenary", authorId: "u-fac",
    body: "全场共享的一句话",
  });
  await addChatThread({
    orgId: ORG, id: "t-g1", projectId: PROJECT, groupId: fx.groups.g1!,
    visibilityScope: "group-shared", createdBy: "u-lead1",
  });
  await addChatMessage({
    orgId: ORG, id: "m-g1-1", threadId: "t-g1", authorId: "u-lead1", body: "第一组的讨论",
  });
  // 组员 u-mem1 的私聊。可读集恒为 {u-mem1, u-lead1, u-fac}（I-7）。
  await addChatThread({
    orgId: ORG, id: "t-private1", projectId: PROJECT, groupId: fx.groups.g1!,
    visibilityScope: "member-private", createdBy: "u-mem1",
  });
  await addChatMessage({
    orgId: ORG, id: "m-private1", threadId: "t-private1", authorId: "u-mem1",
    body: "只有三方能看的私聊内容",
  });
  // ⚠ 显式 60s：这个 hook 有十几次串行写库，在全量并行跑时会超过 vitest 默认的 10s
  //   hook 超时。默认值下它表现为「测试红了」而不是「机器忙」，那是最难查的一种红。
}, 60_000);

/* ══════════════ I-1 可见范围五值封闭 ══════════════ */

describe("I-1: 可见范围枚举封闭，且数据库与契约同源", () => {
  it("数据库 CHECK 的取值集合逐值等于契约枚举", async () => {
    const src = await asApp(ORG, async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'chat_threads_visibility_scope'`,
      );
      return r.rows[0]?.def ?? "";
    });
    const inDb = [...src.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1]!).sort();
    // 断言**集合相等**，不断言长度：数成员数会把一次正当的、经 ADR 的新增拦下来
    // （contract-design §五-7），而集合相等在新增时会明确指出是哪一侧还没跟上。
    expect(inDb).toEqual([...C.ChatVisibility.options].sort());
  });

  it("未声明的取值 safeParse 必失败，且数据库也写不进去", async () => {
    expect(C.ChatVisibility.safeParse("all-hands").success).toBe(false);
    // ⚠ `all-hands` 是 D05 登记的视图侧取值（「全场」到底叫 plenary 还是 all-hands 待人裁）。
    //   这条断言不是在裁决——它断言的是**两侧现在同源**：契约拒绝它，库也必须拒绝它。
    //   裁决改契约那天，上一条测试会立刻要求迁移跟上。
    await expect(
      addChatThread({
        orgId: ORG, id: "t-bogus", projectId: PROJECT, groupId: null,
        visibilityScope: "all-hands", createdBy: "u-fac",
      }),
    ).rejects.toThrow(/chat_threads_visibility_scope/);
  });
});

/* ══════════════ I-2 两层交集：穷举 ══════════════ */

describe("I-2: allowed 恒等于两层的与运算", () => {
  const thread = (scope: (typeof CHAT_VISIBILITY_SCOPES)[number], groupId: string | null): ThreadFacts => ({
    threadId: "t", projectId: PROJECT, groupId, visibilityScope: scope,
    createdBy: "u-author", archived: false,
  });

  it("穷举 (orgRole × projectRole × scope × 同组/跨组)，输出恒等于 org ∧ project", () => {
    const orgRoles = ["consultant", "admin", null] as const;
    let seenAllowed = 0;
    let seenDenied = 0;
    for (const orgRole of orgRoles) {
      for (const projectRole of [...PROJECT_ROLES, null]) {
        for (const scope of CHAT_VISIBILITY_SCOPES) {
          for (const sameGroup of [true, false]) {
            const t = thread(scope, scope === "plenary" ? null : "g1");
            const actor: ActorFacts = {
              userId: "u-someone",
              projectRole,
              groupId: sameGroup ? "g1" : "g2",
            };
            const base = decide({
              decisionId: "d",
              action: chatReadAction(t, actor),
              org: { role: orgRole, teamId: "team-a" },
              project: { role: projectRole, groupId: actor.groupId },
              scope: { scope: "org-wide", ownerTeamId: null },
            });
            const d = decideThreadRead({ thread: t, actor, base });
            // 这就是 I-2 的形式化：不是「大致等价」，是恒等。
            expect(d.allowed, `${orgRole}/${projectRole}/${scope}/${sameGroup}`)
              .toBe(d.orgLayerAllowed && d.projectLayerAllowed);
            // I-4：拒绝恰好带一层，且非空；允许则恒为 null。
            if (d.allowed) {
              expect(d.deniedLayer).toBeNull();
              seenAllowed++;
            } else {
              expect(d.deniedLayer).toMatch(/^(organization|project)$/);
              seenDenied++;
            }
          }
        }
      }
    }
    // 夹具体检：全拒或全放的实现会让上面每一条都平凡成立。
    expect(seenAllowed).toBeGreaterThan(0);
    expect(seenDenied).toBeGreaterThan(0);
  });
});

/* ══════════════ 两个方向，端到端 ══════════════ */

describe("任一层拒绝即拒绝——两个方向各一个用例", () => {
  it("上层给了、下层没给 ⇒ 拒（管理员有组织身份，本项目无角色）", async () => {
    const res = await readThread("u-admin", "t-plenary");
    expect(res.status).toBe(404);
  });

  it("下层给了、上层没给 ⇒ 拒（有项目角色，但不是组织成员）", async () => {
    // 不写 org_memberships，只写 project_memberships：一条在用户被移出组织后
    // 残留下来的项目成员行，绝不能独自授权。
    await addProjectMember(ORG, PROJECT, "u-ghost", "facilitator", null);
    const res = await readThread("u-ghost", "t-plenary");
    expect(res.status).toBe(404);
  });

  it("两层都给 ⇒ 放行（否则上面两条被一个「谁都拒」的实现满足）", async () => {
    const res = await readThread("u-fac", "t-plenary");
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = C.operations.getThread.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });
});

/* ══════════════ I-3 拒绝不泄露存在性 ══════════════ */

describe("I-3: 「不存在」与「存在但无权」逐字节相同", () => {
  it("两次响应的状态码与响应体深相等", async () => {
    const denied = await readThread("u-mem2", "t-private1"); // 存在，别组组员，无权
    const ghost = await readThread("u-mem2", "t-no-such-thread"); // 不存在
    expect(denied.status).toBe(ghost.status);
    const strip = (b: Record<string, unknown>) => ({ ...b, traceId: "<any>" });
    expect(strip((await denied.json()) as Record<string, unknown>)).toEqual(
      strip((await ghost.json()) as Record<string, unknown>),
    );
  });

  it("resolve 端口的拒绝响应里既没有真实 scope 也没有 deniedLayer", async () => {
    const res = await fetch(`${BASE}/chat/visibility/resolve`, {
      method: "POST",
      headers: as("u-mem2"),
      body: JSON.stringify({
        actorId: "u-mem2", projectId: PROJECT, threadId: "t-private1", resourceKind: "thread",
      }),
    });
    const body = (await res.json()) as { allowed: boolean; scope: string; deniedLayer: unknown };
    expect(body.allowed).toBe(false);
    // 真实 scope 是 member-private。回答它等于承认「这里有一条私聊」。
    expect(body.scope).toBe("private");
    expect(body.deniedLayer).toBeNull();
  });
});

/* ══════════════ I-6 跨组 ══════════════ */

describe("I-6: 跨组一律不可见，引导师除外", () => {
  it("第二组的组长与组员读第一组线程 ⇒ 拒", async () => {
    expect((await readThread("u-lead2", "t-g1")).status).toBe(404);
    expect((await readThread("u-mem2", "t-g1")).status).toBe(404);
  });

  it("同一条线程，本组组员读得到（拒绝是边界，不是故障）", async () => {
    expect((await readThread("u-mem1", "t-g1")).status).toBe(200);
  });

  it("引导师跨组读得到（唯一例外）", async () => {
    expect((await readThread("u-fac", "t-g1")).status).toBe(200);
  });
});

/* ══════════════ I-7 私聊三方 ══════════════ */

describe("I-7: member-private 的可读集精确等于 {本人, 本组组长, 引导师}", () => {
  it("五身份遍历，可读集与该集合精确相等（多一个少一个都失败）", async () => {
    const identities = ["u-mem1", "u-lead1", "u-fac", "u-mem1b", "u-mem2", "u-lead2", "u-obs"];
    const readable: string[] = [];
    for (const u of identities) {
      if ((await readThread(u, "t-private1")).status === 200) readable.push(u);
    }
    // 同组的另一个组员 u-mem1b 不在其中——「同组」不等于「可读私聊」，
    // 这是最容易被实现成 group-shared 的一档。
    expect(readable.sort()).toEqual(["u-fac", "u-lead1", "u-mem1"].sort());
  });
});

/* ══════════════ I-8 管理员边界 ══════════════ */

describe("I-8: 管理员读项目层返回内容 + 审计事件，读个人层只返计数", () => {
  const auditCount = () =>
    asApp(ORG, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM provenance_events
          WHERE type = 'admin-project-access' AND actor_id = 'u-admin'`,
      );
      return Number(r.rows[0]!.n);
    });

  it("项目层：200 而不是 403，且**无项目角色**照样可读（O-04）", async () => {
    const before = await auditCount();
    const res = await auditRead("u-admin", "t-plenary", "project");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { card: string | null }[] };
    expect(body.messages.map((m) => m.card)).toContain("全场共享的一句话");
    // ⚠ 早期稿本「无项目角色即 403」的断言已作废（domain.md I-8）。
    expect(await auditCount()).toBe(before + 1);
  });

  it("个人层：只返计数，正文一个字都不出现", async () => {
    const res = await auditRead("u-admin", "t-private1", "personal");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[]; itemCount: number | null };
    expect(body.messages).toEqual([]);
    expect(body.itemCount).toBe(1);
    // 「没有这个字段」而不是「字段是空的」——空字符串是个会被人填上的值。
    expect(JSON.stringify(body)).not.toContain("只有三方能看的私聊内容");
  });

  it("管理员不是万能读：日常读路径上照旧 404", async () => {
    expect((await readThread("u-admin", "t-private1")).status).toBe(404);
  });

  it("非管理员调审计端口 ⇒ 403（与资源是否存在无关，所以这一档可以说实话）", async () => {
    expect((await auditRead("u-fac", "t-plenary", "project")).status).toBe(403);
  });

  it("响应符合契约（拒绝路径也算）", async () => {
    const body = await (await auditRead("u-admin", "t-plenary", "project")).json();
    const parsed = C.operations.adminAuditRead.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });
});

/* ══════════════ I-9 agent 私聊归项目层 ══════════════ */

describe("I-9: agent 私聊的 ownership_layer 恒为 project", () => {
  it("正常写入的 agent 私聊是项目层", async () => {
    await addChatThread({
      orgId: ORG, id: "t-agent", projectId: PROJECT, groupId: fx.groups.g1!,
      visibilityScope: "member-private", createdBy: "u-mem1", agentPrivate: true,
    });
    const layer = await asApp(ORG, async (c) => {
      const r = await c.query<{ ownership_layer: string }>(
        "SELECT ownership_layer FROM chat_threads WHERE id = 't-agent'",
      );
      return r.rows[0]!.ownership_layer;
    });
    expect(layer).toBe("project");
  });

  it("写 personal 被**数据库**拒绝，不是被应用层的 if 拒绝", async () => {
    await expect(
      addChatThread({
        orgId: ORG, id: "t-agent-bad", projectId: PROJECT, groupId: fx.groups.g1!,
        visibilityScope: "member-private", createdBy: "u-mem1",
        agentPrivate: true, ownershipLayer: "personal",
      }),
    ).rejects.toThrow(/ownership_layer/);
  });
});
