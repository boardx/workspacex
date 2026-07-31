/**
 * F81 —— 虚拟 / 真人**混排但强标记**，计数**分列**（uc-6-0 R4 A2 / AC5 / V5，D-25）。
 *
 * ## 「强标记」是数据层的事，不是渲染的事
 *
 * 一个只在列表组件里给虚拟条目加个徽标的实现，界面完全正确、组件单测全绿，
 * 而任何一个直接调这个接口的人（另一个前端、一个脚本、一个 agent）拿到的是
 * 分不出真人与虚拟的数据。所以这个文件里**没有一条断言看的是渲染结果**：
 *
 *   ① HTTP 响应**载荷**里，每一行都带 `sourceKind`，虚拟条目在字节层面可辨。
 *      反证：把标记从载荷里去掉（本文件末尾逐字重放这个改动），断言必须红。
 *   ② `counts` 是两个独立字段。合并成一个总数后，「我们访了 30 个人」里有多少是推演出来的
 *      就再也答不出来了。反证：把两个数加起来，断言必须红。
 *   ③ 混排 —— 虚拟与真人在**同一个列表**里返回，不是两个接口、不是两段。
 *
 * ## 服务端过滤仍然是 F80 那一条
 *
 * 本 feature 没有第二条过滤。所以这里还断言：换一个人来看，响应载荷里
 * **根本不含**他不该看到的条目 —— 这条断言看的是字节，不是 `items` 数组
 * （一个把越权行塞进 `meta` 的实现，在 `items` 上断言会全绿）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { resetInterviews, seedInterview } from "../support/interview-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f81-counts";
const PROJECT = "proj-f81-counts";

const RESEARCHER = "u-f81c-researcher";
/** 同组织的另一个人。他自己有一场，用来证明过滤不是「一律返回空」。 */
const OTHER = "u-f81c-other";

/** 两真人 + 三虚拟。**不是** 1:1 —— 相等的两个数会让「合并成总数」的实现在计数上也蒙对一半。 */
const HUMANS = ["itv-f81c-h1", "itv-f81c-h2"];
const VIRTUALS = ["itv-f81c-v1", "itv-f81c-v2", "itv-f81c-v3"];
const OTHERS_OWN = "itv-f81c-other";
const ALL = [...HUMANS, ...VIRTUALS, OTHERS_OWN];

/** 虚拟条目的标题 —— 原型里的那一行（`DE 德国采购总监 · 数字人`）。标题也是内容。 */
const VIRTUAL_TITLE = "DE 德国采购总监 · 数字人";

let app: NestExpressApplication;
let BASE: string;

const auth = (u: string) => ({ "x-kernel-test-principal": `${u}:${ORG}` });

interface ListBody {
  items: { interviewId: string; sourceKind: string; title: string }[];
  counts: { human: number; virtual: number };
  emptyBecauseNoData: boolean;
}

const listAs = async (user: string): Promise<{ raw: string; body: ListBody }> => {
  const res = await fetch(`${BASE}/interviews?scopeKind=none`, { headers: auth(user) });
  expect(res.status).toBe(200);
  const raw = await res.text();
  return { raw, body: JSON.parse(raw) as ListBody };
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  // ⚠ 显式 hook 超时，与 F80 两个文件同因：hookTimeout 默认 10s，而这里要拉容器 + 跑迁移
  // + 启一个 Nest 应用。超时的症状是「全部 skipped」，看起来像测试没写。
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetInterviews(ORG, ALL);
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetInterviews(ORG, ALL);
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  for (const u of [RESEARCHER, OTHER]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);

  // ⚠ 交替 seed，且 created_at 交错：虚拟与真人**混排**，不是先两条真人再三条虚拟。
  // 顺序一致的 fixture 会让「按 sourceKind 分了两段返回」的实现看起来也对。
  const t0 = Date.UTC(2026, 6, 31, 0, 0, 0);
  const order = [
    { id: HUMANS[0]!, kind: "human" as const },
    { id: VIRTUALS[0]!, kind: "virtual" as const },
    { id: HUMANS[1]!, kind: "human" as const },
    { id: VIRTUALS[1]!, kind: "virtual" as const },
    { id: VIRTUALS[2]!, kind: "virtual" as const },
  ];
  for (const [i, o] of order.entries()) {
    await seedInterview({
      orgId: ORG,
      id: o.id,
      createdBy: RESEARCHER,
      projectId: null,
      sourceKind: o.kind,
      title: o.kind === "virtual" ? `${VIRTUAL_TITLE} ${i}` : `业主 A · 采购总监 ${i}`,
      createdAt: new Date(t0 + i * 60_000),
    });
  }
  await seedInterview({
    orgId: ORG,
    id: OTHERS_OWN,
    createdBy: OTHER,
    projectId: null,
    sourceKind: "human",
    title: "别人的一场",
  });
}, 90_000);

/* ─────────────── ① 强标记在载荷里，逐行可辨 ─────────────── */

describe("① 强标记是数据层的事：响应载荷里每一行都可分辨来源", () => {
  it("每一行都带 sourceKind，且取值只可能是契约那两个", async () => {
    const { body } = await listAs(RESEARCHER);
    expect(body.items.length).toBe(5);
    for (const row of body.items) {
      expect(row.sourceKind, `${row.interviewId} 没有来源标记`).toBeDefined();
      expect(["human", "virtual"]).toContain(row.sourceKind);
    }
  });

  it("虚拟那三条在**字节**层面就带着标记 —— 不是靠前端按 id 去猜", async () => {
    const { raw, body } = await listAs(RESEARCHER);
    const virtualRows = body.items.filter((r) => VIRTUALS.includes(r.interviewId));
    expect(virtualRows.length).toBe(3);
    for (const r of virtualRows) expect(r.sourceKind).toBe("virtual");
    // 响应体里 `"sourceKind":"virtual"` 恰好出现三次。看字节而不是看解析后的结构：
    // 一个把标记只放进 `_meta` 或只放进汇总里的实现，在上面那条上会全绿。
    expect(raw.match(/"sourceKind":"virtual"/g)?.length).toBe(3);
    expect(raw.match(/"sourceKind":"human"/g)?.length).toBe(2);
  });

  it("反证：把标记从载荷里去掉，上面那两条当场红 —— 它们有牙齿", async () => {
    const { body } = await listAs(RESEARCHER);
    // 逐字重放「把强标记从响应载荷里拿掉」这个改动。
    const stripped = {
      ...body,
      items: body.items.map(({ sourceKind: _drop, ...rest }) => rest),
    };
    const raw = JSON.stringify(stripped);
    expect(() => expect(raw.match(/"sourceKind":"virtual"/g)?.length).toBe(3)).toThrow();
    expect(() =>
      expect(
        (stripped.items as { sourceKind?: string }[]).every((r) => r.sourceKind !== undefined),
      ).toBe(true),
    ).toThrow();
  });

  it("混排：虚拟与真人在同一个列表里，且按时间交错 —— 不是分成两段返回", async () => {
    const { body } = await listAs(RESEARCHER);
    const kinds = body.items.map((r) => r.sourceKind);
    // 列表按 created_at DESC，fixture 是 h,v,h,v,v ⇒ 返回应是 v,v,h,v,h。
    expect(kinds).toEqual(["virtual", "virtual", "human", "virtual", "human"]);
    // 「分成两段」= 排序后与原序相同。这里两者必须不同，否则上一行在分段实现下也会对。
    expect(kinds).not.toEqual([...kinds].sort());
  });
});

/* ─────────────── ② 计数分列 ─────────────── */

describe("② counts 是两个独立字段，不得合并（D-25 / V5）", () => {
  it("真人 2 / 虚拟 3，两个数各自正确", async () => {
    const { body } = await listAs(RESEARCHER);
    expect(body.counts).toEqual({ human: 2, virtual: 3 });
  });

  it("载荷里没有一个把两者合起来的总数字段 —— 有了它，下一个人就会去读它", async () => {
    const { body } = await listAs(RESEARCHER);
    expect(Object.keys(body.counts).sort()).toEqual(["human", "virtual"]);
    expect((body.counts as Record<string, unknown>).total).toBeUndefined();
  });

  it("反证：合并成一个总数之后，「访了多少真人」再也答不出来 —— 断言当场红", async () => {
    const { body } = await listAs(RESEARCHER);
    const merged = { total: body.counts.human + body.counts.virtual };
    expect(merged.total).toBe(5);
    // 逐字重放真实断言的形状，并断言它**失败**。
    expect(() => expect(merged as unknown).toEqual({ human: 2, virtual: 3 })).toThrow();
  });

  it("计数统计的是**这个范围**而不是这一页：limit=1 时两个数不变", async () => {
    const res = await fetch(`${BASE}/interviews?scopeKind=none&limit=1`, {
      headers: auth(RESEARCHER),
    });
    const body = (await res.json()) as ListBody;
    expect(body.items.length).toBe(1);
    expect(body.counts).toEqual({ human: 2, virtual: 3 });
  });
});

/* ─────────────── ③ 服务端过滤仍是 F80 那一条 ─────────────── */

describe("③ 列表继承 F80 的服务端过滤：越权条目不在响应载荷里", () => {
  it("另一个人的响应字节里没有研究员那五场的任何 id，也没有虚拟条目的标题", async () => {
    const { raw, body } = await listAs(OTHER);
    for (const id of [...HUMANS, ...VIRTUALS]) {
      expect(raw, `响应体里出现了越权访谈 ${id}`).not.toContain(id);
    }
    expect(raw, "响应体里出现了越权访谈的标题 —— 标题也是内容").not.toContain(VIRTUAL_TITLE);
    // 非空性：过滤不是「一律返回空」。没有这半句，`USING (false)` 完美通过上面两行。
    expect(body.items.map((i) => i.interviewId)).toEqual([OTHERS_OWN]);
  });

  it("他的 counts 只数他看得见的那一场 —— 计数不是绕过过滤的旁路", async () => {
    const { body } = await listAs(OTHER);
    expect(body.counts).toEqual({ human: 1, virtual: 0 });
    // 反证：若 counts 走的是全量，这里会是 3 真人 3 虚拟。
    expect(() => expect(body.counts).toEqual({ human: 3, virtual: 3 })).toThrow();
  });

  it("研究员自己那一次里，那五场确实都在 —— 证明上一条测的是过滤而不是接口坏了", async () => {
    const { raw } = await listAs(RESEARCHER);
    for (const id of [...HUMANS, ...VIRTUALS]) expect(raw).toContain(id);
  });
});
