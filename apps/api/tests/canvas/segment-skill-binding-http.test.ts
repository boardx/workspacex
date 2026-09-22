/**
 * #1468 — `bindSkillToSegment` + `listSegmentSkills`，HTTP 边界端到端。
 *
 * ## 这两条为什么一起测
 *
 * `usecases.md` 签核这两条操作的时间与 `bindTemplateToSegment` 同一次，`coverage.md` 的
 * 端口对照表里三条都是 ✅。而在本 PR 之前：`bindTemplateToSegment` 有表、有用例、有路由
 * （#493 补的），skill 那两条**一样都没有**——`grep -rn "skill-bindings" apps/api/src/interface`
 * 零命中，全仓也没有任何一张表存过一条 skill 绑定。前端
 * `apps/web/components/canvas/segment-binding.tsx` 的「加挂 skill」因此只能是 mock。
 *
 * 分开交付一条写路由没有意义：写完之后没有任何真实读路径能看见它，「绑了 → 刷新 →
 * 还在」这条闭环仍然做不出来，而这正是 uc-7-4 V3 与 uc-7-1 V6（空态）要的东西。
 *
 * ## 反证方向
 *
 * 本文件每一条断言在 #1468 之前都是红的，且是最钝的那种红：两条路由都不存在，
 * 所以 `POST /canvas/agenda-segments/:id/skill-bindings` 与
 * `GET /canvas/agenda-segments/:id/skills` 一律 404，连 403 都到不了。
 *
 * 断言的是**库**与**真实响应**，不是回显：
 * · 写路径写进去之后用 `asApp`（app 角色、走 RLS）把行读回来比对，响应体不算数
 *   ——一个逐字回显请求的实现与一次没发生的写入在响应上完全同形。
 * · 读路径的断言全部经 `C.operations.listSegmentSkills.out.parse`，多一个字段或少一个
 *   字段在这里红，而不是等前端集成时才发现。
 *
 * ## 这里**没有**测什么
 *
 * `runSegmentSkill`（第三条，`POST .../skill-runs`）本 PR 没有实现，所以这里也没有它的
 * 用例——理由写在 `interface/controllers/canvas-segment-skill.controller.ts` 的文件头
 * （它要的是 context pack + 后台任务运行时，不是又一条 CRUD 路由）。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedAgendaSegment,
  seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1468-skill";
const OTHER_ORG = "org-1468-skill-other";
const WORKSHOP = `${ORG}-workshop`;
const OTHER_WORKSHOP = `${OTHER_ORG}-workshop`;
const SEGMENT_A = `${WORKSHOP}-seg-a`;
const SEGMENT_B = `${WORKSHOP}-seg-b`;
const OTHER_SEGMENT = `${OTHER_WORKSHOP}-seg`;

/** 引导师 —— `usecases.md` 的 `pre:` 逐字只有这一个角色。 */
const FACILITATOR = "u-1468-facilitator";
/**
 * 组长。⚠ 反例不用 `member`：`pre:` 的括号里写的是「组员不可自行加挂」，而 `groupLead`
 * 比组员资历更高——用它做反例才能证明这道门挡的是「不是引导师」，不是「是组员」。
 */
const GROUP_LEAD = "u-1468-group-lead";
const OUTSIDER = "u-1468-outsider";

let BASE: string;
let app: NestExpressApplication;

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

/** 直接读库，不信响应体。 */
async function readSkillBindings(
  segmentId: string,
  orgId = ORG,
): Promise<readonly { id: string; skill_key: string; run_mode: string; last_run_at: Date | null }[]> {
  return asApp(orgId, async (c) => {
    const r = await c.query<{ id: string; skill_key: string; run_mode: string; last_run_at: Date | null }>(
      `SELECT id, skill_key, run_mode, last_run_at FROM canvas_segment_skill_bindings
        WHERE org_id=$1 AND agenda_segment_id=$2 ORDER BY skill_key`,
      [orgId, segmentId],
    );
    return r.rows;
  });
}

/**
 * 造一个组织自己的 skill。
 *
 * ⚠ 经 SQL 而不是某条 HTTP 路由：本束的契约里没有「创建 skill」的操作（那属 skills 束），
 *   而借另一个束的端点来准备夹具，会让这份测试在那个端点变化时红在与本 PR 无关的地方。
 */
async function seedSkill(t: { readonly key: string; readonly name: string; readonly orgId?: string }): Promise<void> {
  const orgId = t.orgId ?? ORG;
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5, now(), now())`,
      [`${orgId}-${t.key}`, orgId, t.key, t.name, FACILITATOR],
    ),
  );
}

const bindPath = (segmentId: string) =>
  C.operations.bindSkillToSegment.path.replace(":agendaSegmentId", encodeURIComponent(segmentId));

const listPath = (segmentId: string) =>
  C.operations.listSegmentSkills.path.replace(":agendaSegmentId", encodeURIComponent(segmentId));

const bind = (segmentId: string, body: unknown, userId = FACILITATOR, orgId = ORG) =>
  fetch(`${BASE}${bindPath(segmentId)}`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });

const list = (segmentId: string, userId = FACILITATOR, orgId = ORG) =>
  fetch(`${BASE}${listPath(segmentId)}`, { headers: authFor(userId, orgId) });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: WORKSHOP });
  await seedOrg({ orgId: OTHER_ORG, projectId: OTHER_WORKSHOP });
  await addOrgMember(ORG, FACILITATOR, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, GROUP_LEAD, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, OUTSIDER, "consultant", fixture.teams.energy!);
  await addProjectMember(ORG, WORKSHOP, FACILITATOR, "facilitator", null, true);
  await addProjectMember(ORG, WORKSHOP, GROUP_LEAD, "groupLead", fixture.groups.g1!);
  // ⚠ OUTSIDER 是组织成员但**不是**项目成员：这样它撞到的才是项目角色那道门，
  //   而不是更外层的「你根本不在这个组织」。
  await seedAgendaSegment(ORG, WORKSHOP, SEGMENT_A);
  await seedAgendaSegment(ORG, WORKSHOP, SEGMENT_B);
  await seedAgendaSegment(OTHER_ORG, OTHER_WORKSHOP, OTHER_SEGMENT);
});

describe("#1468 · 绑定把 skill 真的写进库", () => {
  it("引导师加挂一个 skill：响应过契约，且库里真有那一行", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A,
      skillKey: "persona-digger",
      runMode: "once",
    });
    expect(res.status).toBe(200);

    const parsed = C.operations.bindSkillToSegment.out.parse(await res.json());
    expect(parsed.bindingId.length).toBeGreaterThan(0);

    const rows = await readSkillBindings(SEGMENT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(parsed.bindingId);
    expect(rows[0]!.skill_key).toBe("persona-digger");
    expect(rows[0]!.run_mode).toBe("once");
    // `lastRunAt` 的写入方是 `runSegmentSkill`，本 PR 没有实现它 ⇒ 这一列今天恒为 NULL。
    // 断言它，是为了让「有人偷偷给它塞了个 now()」这种伪装成已实现的改动在这里红。
    expect(rows[0]!.last_run_at).toBeNull();
  });

  it("两种 runMode 都能落库，且是分别落在各自的环节上", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });
    await seedSkill({ key: "live-summary", name: "现场纪要" });

    expect((await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "once",
    })).status).toBe(200);
    expect((await bind(SEGMENT_B, {
      agendaSegmentId: SEGMENT_B, skillKey: "live-summary", runMode: "always-on",
    })).status).toBe(200);

    expect((await readSkillBindings(SEGMENT_A)).map((r) => [r.skill_key, r.run_mode]))
      .toEqual([["persona-digger", "once"]]);
    expect((await readSkillBindings(SEGMENT_B)).map((r) => [r.skill_key, r.run_mode]))
      .toEqual([["live-summary", "always-on"]]);
  });

  /**
   * 契约的 `err` 里**没有**冲突码，也**没有**解绑操作 —— 所以第二次绑定必须成功。
   * 它落成什么是本 PR 唯一一处「契约没直说、实现必须选一个」的地方，论证写在
   * `segment-skill-ports.ts` 的端口注释：改既有那一行，`bindingId` 不变。
   *
   * 这条同时是「别把换模式实现成先删后插」的反证：`bindingId` 一旦变了，调用方手里的
   * 那个 id 就在没有任何错误的情况下指向了一个不存在的东西。
   */
  it("同一环节重复绑同一个 skill：改 runMode，不是第二行，也不换 bindingId", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });

    const first = C.operations.bindSkillToSegment.out.parse(
      await (await bind(SEGMENT_A, {
        agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "once",
      })).json(),
    );

    const second = C.operations.bindSkillToSegment.out.parse(
      await (await bind(SEGMENT_A, {
        agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "always-on",
      })).json(),
    );

    expect(second.bindingId).toBe(first.bindingId);

    const rows = await readSkillBindings(SEGMENT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.run_mode).toBe("always-on");
  });

  it("契约里没有的 runMode 值被拒 400，且库里没有留下任何行", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "sometimes",
    });
    expect(res.status).toBe(400);
    expect(await readSkillBindings(SEGMENT_A)).toHaveLength(0);
  });

  it("路径参数与 body 的 agendaSegmentId 打架 ⇒ 400，不静默挑一个", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_B, skillKey: "persona-digger", runMode: "once",
    });
    expect(res.status).toBe(400);
    expect(await readSkillBindings(SEGMENT_A)).toHaveLength(0);
    expect(await readSkillBindings(SEGMENT_B)).toHaveLength(0);
  });

  /**
   * 契约的 `bindSkillToSegment.err` 里**没有** `SKILL_NOT_FOUND`（对照同一束的
   * `bindTemplateToSegment` 有 `TEMPLATE_NOT_FOUND`——两条操作的 err 集合是分别签核的）。
   * 所以绑一个当前查不到的 key 必须**成功**：加一次存在性校验，就得为它的否定分支
   * 发明一个契约里没有的响应。
   */
  it("绑一个当前不存在的 skillKey：成功，不发明 SKILL_NOT_FOUND", async () => {
    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, skillKey: "not-created-yet", runMode: "once",
    });
    expect(res.status).toBe(200);
    expect((await readSkillBindings(SEGMENT_A)).map((r) => r.skill_key)).toEqual(["not-created-yet"]);
  });
});

describe("#1468 · 谁能加挂（uc-7-4 R7：组员不可自行加挂）", () => {
  it("组长加挂被拒 403 ROLE_INSUFFICIENT，且库里没有那一行", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "once",
    }, GROUP_LEAD);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readSkillBindings(SEGMENT_A)).toHaveLength(0);
  });

  /**
   * 「不在这个项目里」与「在项目里但角色不够」回**同一个码**：契约的 `err` 联合里没有
   * 「你不在这个项目里」这一项，把非成员单独渲染成另一种拒绝，等于告诉一个陌生人
   * 「这个工作坊存在，只是你不在里面」。
   */
  it("非项目成员加挂：同样是 403 ROLE_INSUFFICIENT，不另开一种拒绝", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "once",
    }, OUTSIDER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
  });

  it("环节不存在 ⇒ 404；别的组织的环节走同一个出口，不泄露存在性", async () => {
    expect((await bind("no-such-segment", {
      agendaSegmentId: "no-such-segment", skillKey: "x", runMode: "once",
    })).status).toBe(404);

    // 环节真实存在，只是属于另一个组织：RLS 让它在这条路径上根本查不到 ⇒ 同一个 404。
    expect((await bind(OTHER_SEGMENT, {
      agendaSegmentId: OTHER_SEGMENT, skillKey: "x", runMode: "once",
    })).status).toBe(404);
    expect(await readSkillBindings(OTHER_SEGMENT, OTHER_ORG)).toHaveLength(0);
  });
});

describe("#1468 · listSegmentSkills：绑了 → 刷新 → 还在", () => {
  /** uc-7-1 V6：模板库为空、环节未绑时显示**真实空态**，不生成示例。 */
  it("没有任何绑定时回空数组，不编一条示例 skill", async () => {
    const res = await list(SEGMENT_A);
    expect(res.status).toBe(200);
    expect(C.operations.listSegmentSkills.out.parse(await res.json())).toEqual({ skills: [] });
  });

  it("绑定之后读得到：displayName 来自 skills 表，runMode 与绑定一致，lastRunAt 为 null", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });
    await bind(SEGMENT_A, { agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "always-on" });

    const parsed = C.operations.listSegmentSkills.out.parse(await (await list(SEGMENT_A)).json());
    expect(parsed.skills).toEqual([
      { skillKey: "persona-digger", displayName: "画像深挖", runMode: "always-on", lastRunAt: null },
    ]);
  });

  /**
   * uc-7-4 V3 的前半：环节 A 绑三条回三条、环节 B 绑一条回一条。白名单是**按环节**的，
   * 不是按项目——两个环节互不串台。
   */
  it("白名单按环节各算各的：A 绑三条回三条，B 绑一条回一条", async () => {
    await seedSkill({ key: "s1", name: "一号" });
    await seedSkill({ key: "s2", name: "二号" });
    await seedSkill({ key: "s3", name: "三号" });

    for (const key of ["s1", "s2", "s3"]) {
      expect((await bind(SEGMENT_A, {
        agendaSegmentId: SEGMENT_A, skillKey: key, runMode: "once",
      })).status).toBe(200);
    }
    expect((await bind(SEGMENT_B, {
      agendaSegmentId: SEGMENT_B, skillKey: "s2", runMode: "once",
    })).status).toBe(200);

    const a = C.operations.listSegmentSkills.out.parse(await (await list(SEGMENT_A)).json());
    const b = C.operations.listSegmentSkills.out.parse(await (await list(SEGMENT_B)).json());
    expect(a.skills.map((s) => s.skillKey)).toEqual(["s1", "s2", "s3"]);
    expect(b.skills.map((s) => s.skillKey)).toEqual(["s2"]);
  });

  /**
   * 本 PR 唯一一条「实现替契约补了一个字」的判定，反证在这里：名字查不到的绑定
   * **不从白名单里消失**。少一行会让 `runSegmentSkill`（判绑定，I-32）与这张列表
   * 对同一个事实给出两种答案——「列表里没有、却能跑」。
   */
  it("绑定指向一个查不到名字的 skillKey：行仍在，displayName 退回 skillKey", async () => {
    await seedSkill({ key: "known", name: "有名字的" });
    await bind(SEGMENT_A, { agendaSegmentId: SEGMENT_A, skillKey: "known", runMode: "once" });
    await bind(SEGMENT_A, { agendaSegmentId: SEGMENT_A, skillKey: "ghost", runMode: "once" });

    const parsed = C.operations.listSegmentSkills.out.parse(await (await list(SEGMENT_A)).json());
    expect(parsed.skills).toEqual([
      { skillKey: "ghost", displayName: "ghost", runMode: "once", lastRunAt: null },
      { skillKey: "known", displayName: "有名字的", runMode: "once", lastRunAt: null },
    ]);
  });

  /**
   * 读与写是**两条不同的判据**：写判引导师（`agendaSegment.bindSkill`），读判
   * `read.published`——四种项目角色都持有它。组长读得到，正是这两条判据没有被合成一条
   * 的证据；合成一条的实现在这里会红。
   */
  it("组长读得到白名单（读判 read.published，不是引导师）", async () => {
    await seedSkill({ key: "persona-digger", name: "画像深挖" });
    await bind(SEGMENT_A, { agendaSegmentId: SEGMENT_A, skillKey: "persona-digger", runMode: "once" });

    const res = await list(SEGMENT_A, GROUP_LEAD);
    expect(res.status).toBe(200);
    expect(C.operations.listSegmentSkills.out.parse(await res.json()).skills.map((s) => s.skillKey))
      .toEqual(["persona-digger"]);
  });

  /** 契约 `listSegmentSkills.err` 只有 `NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE`。 */
  it("非项目成员读被拒 403 NO_PROJECT_ROLE", async () => {
    const res = await list(SEGMENT_A, OUTSIDER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NO_PROJECT_ROLE");
  });

  it("跨组织读：另一个组织的环节 ⇒ 404，与「不存在」同一个出口", async () => {
    expect((await list(OTHER_SEGMENT)).status).toBe(404);
    expect((await list("no-such-segment")).status).toBe(404);
  });

  /**
   * 跨租户隔离不是靠应用层的 `WHERE org_id`：两个组织各自绑同一个 `skillKey`，
   * 谁也读不到对方那一条。
   */
  it("同名 skillKey 在两个组织各绑一条，互不可见", async () => {
    await seedSkill({ key: "shared-name", name: "本组织的" });
    await seedSkill({ key: "shared-name", name: "别人的", orgId: OTHER_ORG });
    await addOrgMember(OTHER_ORG, FACILITATOR, "consultant", null);
    await addProjectMember(OTHER_ORG, OTHER_WORKSHOP, FACILITATOR, "facilitator", null, true);

    await bind(SEGMENT_A, { agendaSegmentId: SEGMENT_A, skillKey: "shared-name", runMode: "once" });
    await bind(OTHER_SEGMENT, {
      agendaSegmentId: OTHER_SEGMENT, skillKey: "shared-name", runMode: "always-on",
    }, FACILITATOR, OTHER_ORG);

    const mine = C.operations.listSegmentSkills.out.parse(await (await list(SEGMENT_A)).json());
    expect(mine.skills).toEqual([
      { skillKey: "shared-name", displayName: "本组织的", runMode: "once", lastRunAt: null },
    ]);

    const theirs = C.operations.listSegmentSkills.out.parse(
      await (await list(OTHER_SEGMENT, FACILITATOR, OTHER_ORG)).json(),
    );
    expect(theirs.skills).toEqual([
      { skillKey: "shared-name", displayName: "别人的", runMode: "always-on", lastRunAt: null },
    ]);
  });
});
