/**
 * #493 — `bindTemplateToSegment`, the HTTP boundary, end to end.
 *
 * ## What "使用一个模板" means here, and why it is not a judgement call
 *
 * #493 asks for the eighth step of the core loop: 「使用可视化模板」. The signed
 * `canvas.ts` contract does not leave that open — it defines template *usage* mechanically,
 * in two places that both count the same rows:
 *
 *   · `listTemplates.out.usageCount`            —— 「必须真实统计，不得估算」
 *   · `archiveTemplate.out.stillBoundSegmentCount` —— 「有 N 个 agenda_segment 仍绑定此模板」
 *
 * and `20260805030000_canvas_template_registry.sql` names `canvas_template_bindings` as
 * 「两个契约字段的唯一事实源」. A template is *in use* exactly when a row exists in that
 * table. The only operation that writes one is `bindTemplateToSegment` — which that same
 * migration records as having **no writer**: 「写它的操作是契约里的 bindTemplateToSegment
 * （F102 那条 HTTP 边界），不在 #463 范围内」.
 *
 * So this file does not test a slice somebody chose. It tests the one write that makes the
 * contract's own definition of usage go from 0 to 1.
 *
 * ## Nothing here asserts against a pure function
 *
 * `domain/canvas/segment-binding.ts` has been green since F102 — `canBindTemplateToSegment`
 * and the domain `instantiateForSegment` are both fully implemented and fully tested by
 * `tests/canvas/segment-two-template-limit.test.ts` and
 * `tests/canvas/segment-binding-instantiation.test.ts`. F102 is marked `passing` on the
 * strength of those. No HTTP route reaches either function, and `canvas_template_bindings`
 * has never had a row written by product code. The domain is green and unreachable — the
 * same shape #463 found for F100/F101.
 *
 * ⇒ every assertion below goes **real HTTP → controller → application → repository →
 * PostgreSQL**, and the durable side is re-read with `asApp` (the app role, under RLS)
 * rather than trusted from the response body: a response can echo the caller's own request
 * and be indistinguishable from a write that never happened.
 *
 * ## Where template rows come from
 *
 * ⚠ Seeded through SQL, for the reason `template-lifecycle-http.test.ts` states at length:
 * the signed contract has **no operation that creates a template**. That gap stays visible
 * rather than being papered over by an endpoint nobody reviewed.
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

const ORG = "org-493-bind";
const OTHER_ORG = "org-493-bind-other";
const WORKSHOP = `${ORG}-workshop`;
const OTHER_WORKSHOP = `${OTHER_ORG}-workshop`;
const SEGMENT_A = `${WORKSHOP}-seg-a`;
const SEGMENT_B = `${WORKSHOP}-seg-b`;
const OTHER_SEGMENT = `${OTHER_WORKSHOP}-seg`;

const ADMIN = "u-493-admin";
/** 引导师 —— `usecases.md` 的 `pre:` 逐字只有这一个角色。 */
const FACILITATOR = "u-493-facilitator";
/** 组长。⚠ 不用 `member`：`groupLead` 资历更高，用它做反例才能证明门不是「随便挡一下」。 */
const GROUP_LEAD = "u-493-group-lead";
const OUTSIDER = "u-493-outsider";

let BASE: string;
let app: NestExpressApplication;

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

const SECTIONS = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
  { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: 5 },
];

async function seedTemplate(t: {
  readonly orgId?: string;
  readonly key: string;
  readonly version: number;
  readonly status: "draft" | "trial" | "published" | "archived";
  readonly archivedFrom?: "draft" | "trial" | "published" | null;
}): Promise<void> {
  const orgId = t.orgId ?? ORG;
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          underlying_type, sections)
       VALUES ($1,$2,$3,$4,$5,$6,false,'org-wide','canvas',$7::jsonb)`,
      [orgId, t.key, t.version, t.key, t.status, t.archivedFrom ?? null, JSON.stringify(SECTIONS)],
    ),
  );
}

/** 直接读库，不信响应体。 */
async function readBindings(
  segmentId: string,
  orgId = ORG,
): Promise<readonly { id: string; template_key: string; template_version: number }[]> {
  return asApp(orgId, async (c) => {
    const r = await c.query<{ id: string; template_key: string; template_version: number }>(
      `SELECT id, template_key, template_version FROM canvas_template_bindings
        WHERE org_id=$1 AND agenda_segment_id=$2 ORDER BY template_key`,
      [orgId, segmentId],
    );
    return r.rows;
  });
}

const bindPath = (segmentId: string) =>
  C.operations.bindTemplateToSegment.path.replace(
    ":agendaSegmentId",
    encodeURIComponent(segmentId),
  );

const bind = (
  segmentId: string,
  body: unknown,
  userId = FACILITATOR,
  orgId = ORG,
) =>
  fetch(`${BASE}${bindPath(segmentId)}`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });

const usageCountOf = async (key: string, userId = ADMIN): Promise<number> => {
  const res = await fetch(`${BASE}/canvas/templates?orgId=${ORG}`, { headers: authFor(userId) });
  const parsed = C.operations.listTemplates.out.parse(await res.json());
  return parsed.templates.find((t) => t.key === key)!.usageCount;
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
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
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, FACILITATOR, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, GROUP_LEAD, "consultant", fixture.teams.energy!);
  await addProjectMember(ORG, WORKSHOP, FACILITATOR, "facilitator", null, true);
  await addProjectMember(ORG, WORKSHOP, GROUP_LEAD, "groupLead", fixture.groups.g1!);
  await seedAgendaSegment(ORG, WORKSHOP, SEGMENT_A);
  await seedAgendaSegment(ORG, WORKSHOP, SEGMENT_B);
  await seedAgendaSegment(OTHER_ORG, OTHER_WORKSHOP, OTHER_SEGMENT);
});

describe("#493 · 绑定把模板真的写进库，usageCount 随之从 0 变 1", () => {
  it("引导师绑定一个 published 模板：响应过契约，且库里真有那一行", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A,
      templateKey: "swot",
      templateVersion: 1,
    });
    expect(res.status).toBe(200);

    // 出门过契约自己的 `.strict()`：多一个字段在这里红，而不是等前端集成时才发现。
    const parsed = C.operations.bindTemplateToSegment.out.parse(await res.json());
    expect(parsed.templateKey).toBe("swot");
    expect(parsed.boundTemplateVersion).toBe(1);
    expect(parsed.bindingId.length).toBeGreaterThan(0);

    // ⚠ 断言的是**库**，不是响应体。响应体可以逐字回显请求而与一次没发生的写入同形。
    const rows = await readBindings(SEGMENT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(parsed.bindingId);
    expect(rows[0]!.template_key).toBe("swot");
    expect(rows[0]!.template_version).toBe(1);
  });

  /**
   * 这条是 #493 的**核心断言**：契约把「模板被用了」定义成 `usageCount`，而 `usageCount`
   * 是 `canvas_template_bindings` 的 `COUNT(*)`。绑定之前它是 0，之后是 1 —— 这就是
   * 「使用一个模板」在签核过的契约里唯一可机械观测的形态。
   */
  it("usageCount：绑定前 0，绑定后 1 —— 数的是真行，不是估算", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    expect(await usageCountOf("swot")).toBe(0);

    expect((await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, templateKey: "swot", templateVersion: 1,
    })).status).toBe(200);

    expect(await usageCountOf("swot")).toBe(1);

    // 第二个环节绑同一个模板 ⇒ 2。「使用数」必须跟着环节走。
    expect((await bind(SEGMENT_B, {
      agendaSegmentId: SEGMENT_B, templateKey: "swot", templateVersion: 1,
    })).status).toBe(200);
    expect(await usageCountOf("swot")).toBe(2);
  });

  /**
   * `archiveTemplate.out.stillBoundSegmentCount` 与 `usageCount` 数的是同一批行。
   * 契约逐字：「返回 0 与不返回是两回事」。绑定接上之前，它只可能是 0。
   */
  it("stillBoundSegmentCount 跟着绑定动 —— 归档预检看得见影响面", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    await bind(SEGMENT_A, { agendaSegmentId: SEGMENT_A, templateKey: "swot", templateVersion: 1 });

    const res = await fetch(`${BASE}/canvas/templates/swot/archive`, {
      method: "POST",
      headers: authFor(ADMIN),
      body: JSON.stringify({ key: "swot", version: 1, confirmed: false }),
    });
    const parsed = C.operations.archiveTemplate.out.parse(await res.json());
    expect(parsed.stillBoundSegmentCount).toBe(1);
  });
});

describe("#493 · 绑定当时的版本被冻结，此后模板怎么变都不改写它（F102 反向断言）", () => {
  /**
   * ⚠ 这条是**先绑定、后改模板**的反向断言，不是正向地只测「绑定时版本正确」。
   * `domain/canvas/segment-binding.ts` 的文件头点名要求这个方向：正向断言在
   * 「实现每次都重查注册表当前版本」时**照样全绿**。
   */
  it("绑定 v1 之后发布 v2：绑定行仍然指向 v1", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    await seedTemplate({ key: "swot", version: 2, status: "trial" });

    await bind(SEGMENT_A, { agendaSegmentId: SEGMENT_A, templateKey: "swot", templateVersion: 1 });

    const publish = await fetch(`${BASE}/canvas/templates/swot/publish`, {
      method: "POST",
      headers: authFor(ADMIN),
      body: JSON.stringify({ key: "swot", version: 2, visibility: "org-wide" }),
    });
    expect(publish.status).toBe(200);

    const rows = await readBindings(SEGMENT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.template_version).toBe(1);
  });
});

describe("#493 · 拒绝面：每个码都来自 bindTemplateToSegment.err，没有一个是编的", () => {
  it("模板不存在 ⇒ 404 TEMPLATE_NOT_FOUND", async () => {
    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, templateKey: "nope", templateVersion: 1,
    });
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_FOUND");
    expect(await readBindings(SEGMENT_A)).toHaveLength(0);
  });

  /**
   * I-5 绑定半条：`canCreateNewBinding` 只放行 `published`。draft / trial / archived
   * 三种状态**都**走这个码 —— 逐个测，而不是只测 archived 一个然后相信另外两个。
   */
  it.each(["draft", "trial", "archived"] as const)(
    "%s 状态的模板不能被新绑 ⇒ 403 TEMPLATE_ARCHIVED",
    async (status) => {
      await seedTemplate({
        key: "swot", version: 1, status,
        archivedFrom: status === "archived" ? "published" : null,
      });
      const res = await bind(SEGMENT_A, {
        agendaSegmentId: SEGMENT_A, templateKey: "swot", templateVersion: 1,
      });
      expect(res.status).toBe(403);
      expect(await reasonCodeOf(res)).toBe("TEMPLATE_ARCHIVED");
      expect(await readBindings(SEGMENT_A)).toHaveLength(0);
    },
  );

  /** I-6：同一议程环节最多两个模板。 */
  it("第三个模板 ⇒ 403 SEGMENT_TEMPLATE_LIMIT，且第三行没有落库", async () => {
    for (const key of ["swot", "bmc", "mvp"]) {
      await seedTemplate({ key, version: 1, status: "published" });
    }
    for (const key of ["swot", "bmc"]) {
      expect((await bind(SEGMENT_A, {
        agendaSegmentId: SEGMENT_A, templateKey: key, templateVersion: 1,
      })).status).toBe(200);
    }

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, templateKey: "mvp", templateVersion: 1,
    });
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("SEGMENT_TEMPLATE_LIMIT");

    const rows = await readBindings(SEGMENT_A);
    expect(rows.map((r) => r.template_key)).toEqual(["bmc", "swot"]);

    // ⚠ 上限是**每个环节**的，不是每个工作坊的 —— 另一个环节照常绑得上。
    expect((await bind(SEGMENT_B, {
      agendaSegmentId: SEGMENT_B, templateKey: "mvp", templateVersion: 1,
    })).status).toBe(200);
  });

  it.each([
    ["组长", GROUP_LEAD],
    ["非本组织成员", OUTSIDER],
  ])("%s 绑不了 ⇒ 403 ROLE_INSUFFICIENT，且什么都没写进去", async (_label, userId) => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, templateKey: "swot", templateVersion: 1,
    }, userId);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readBindings(SEGMENT_A)).toHaveLength(0);
  });

  it("环节不存在（或属于别的组织）⇒ 404，且不泄露它存在于别处", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const res = await bind(OTHER_SEGMENT, {
      agendaSegmentId: OTHER_SEGMENT, templateKey: "swot", templateVersion: 1,
    });
    expect(res.status).toBe(404);
    expect(await readBindings(OTHER_SEGMENT, OTHER_ORG)).toHaveLength(0);
  });

  it("路径参数与 body 打架 ⇒ 400，不静默挑一个", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_B, templateKey: "swot", templateVersion: 1,
    });
    expect(res.status).toBe(400);
    expect(await readBindings(SEGMENT_A)).toHaveLength(0);
    expect(await readBindings(SEGMENT_B)).toHaveLength(0);
  });

  /**
   * 同一环节重复绑同一个 key。
   *
   * ⚠ 契约的 `bindTemplateToSegment.err` 里**没有**「已经绑过了」这个码，所以这里抛的是
   *   **裸 409**（不带 reasonCode）—— 与本束 `CanvasPublishedVersionConflictError` 的处理
   *   逐字同型，理由也逐字相同：编一个最像的码，前端就会按一个在契约里含义不同的码分支。
   *   这是契约缺口，报在 #493，不在这里用一个看起来差不多的码盖住。
   *
   * ⚠ 重绑的是**同一个版本**，不是 v2。`canvas_templates_one_published_per_key` 保证同一个
   *   key 最多一个 published 版本，而 `canCreateNewBinding` 只放行 published ⇒ 拿 v2 来重绑
   *   会先撞上 `TEMPLATE_ARCHIVED`，这条用例就永远到不了唯一约束那一步，看起来在测冲突、
   *   实际在测另一个码。（第一版就是这么写的，被实现打回来了。）
   */
  it("重复绑同一个 key ⇒ 409，且原来那一行原封不动", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const first = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, templateKey: "swot", templateVersion: 1,
    });
    const firstBindingId = C.operations.bindTemplateToSegment.out.parse(await first.json()).bindingId;

    const res = await bind(SEGMENT_A, {
      agendaSegmentId: SEGMENT_A, templateKey: "swot", templateVersion: 1,
    });
    expect(res.status).toBe(409);
    expect(await reasonCodeOf(res)).toBeUndefined();

    // ⚠ 断言的是 `bindingId` **没有变**，而不只是行数还是 1。行数不变在「删旧行插新行」
    //   的实现下同样成立，而那种实现会把一个已被别处引用的 bindingId 悄悄换掉。
    const rows = await readBindings(SEGMENT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(firstBindingId);
    expect(rows[0]!.template_version).toBe(1);
    // usageCount 也没有被这次失败的重绑推高 —— 冲突不是一次「成功但没写」。
    expect(await usageCountOf("swot")).toBe(1);
  });
});
