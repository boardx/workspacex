/**
 * UC-17.8 D1 / B2.4 —— 结构化补充字段：
 *   · `listFeedback` 投影里 `structured` 与 `detail` 走同一条 D3 门控（无权 ⇒ 两者都 null）；
 *   · `submitFeedback` 把 `structured` 落进仓储（缺省 ⇒ null）；
 *   · `structureFeedbackDraft` 的解析：按 kind 认字段、缺/坏 ⇒ null、正文仍是完整原文；
 *   · `deriveFeedbackTitle` 与前端同一规则。
 */
import { describe, expect, it, vi } from "vitest";
import { guard } from "../../src/application/security/permission-filter";
import { listFeedback } from "../../src/application/feedback/list-feedback";
import { submitFeedback } from "../../src/application/feedback/submit-feedback";
import { parseStructuredForKind, structureFeedbackDraft } from "../../src/application/feedback/structure-feedback-draft";
import { deriveFeedbackTitle } from "../../src/domain/feedback/derive-feedback-title";
import type { FeedbackRow, ProductFeedbackRepository } from "../../src/application/feedback/ports";
import { fakeFeedbackRepo } from "./draft-fakes";

function row(id: string, submittedBy: string): FeedbackRow {
  return {
    id, submittedBy, kind: "缺陷", target: { kind: "product" }, targetLabel: null, title: "t",
    detail: guard({ kind: "feedback", id }, "正文"),
    structured: guard({ kind: "feedback", id }, { expectedResult: "能导出" }),
    status: "待处理", statusReason: null, votes: 0, votedByMe: false, occurredRoute: null, appVersion: null,
    createdAt: "2026-09-04T00:00:00.000Z", githubIssueUrl: null, githubIssueNumber: null,
  };
}

describe("D1 结构化字段随 D3 门控投影", () => {
  it("自己提的可见 ⇒ structured 有值；别人提的、非管理员 ⇒ detail 与 structured 同时 null", async () => {
    const repo = { list: vi.fn(async () => [row("fb-mine", "u-me"), row("fb-other", "u-other")]) } as unknown as ProductFeedbackRepository;
    let n = 0;
    const items = await listFeedback({ repo, newDecisionId: () => `dec-${++n}` }, {
      scope: { kind: "org" }, viewerId: "u-me", viewerOrgRole: "consultant", viewerTeamId: null,
    });
    expect(items.map((i) => [i.id, i.detail, i.structured])).toEqual([
      ["fb-mine", "正文", { expectedResult: "能导出" }],
      ["fb-other", null, null],
    ]);
  });

  it("submitFeedback：structured 落仓储，缺省为 null", async () => {
    const fb = fakeFeedbackRepo();
    const deps = { repo: fb.repo, newFeedbackId: () => "fb-1", newEventId: () => "ev-1" };
    const base = { submittedBy: "u", kind: "需求" as const, target: { kind: "product" as const }, targetLabel: null, title: "t", detail: "d", occurredRoute: null, appVersion: null };
    await submitFeedback(deps, base);
    await submitFeedback(deps, { ...base, structured: { priorityScope: "P1 · 全部项目" } });
    expect(fb.inserted.map((r) => r.structured)).toEqual([null, { priorityScope: "P1 · 全部项目" }]);
  });
});

describe("B2.4 语音 → 结构化字段", () => {
  it("parseStructuredForKind：按 kind 认字段；空对象/错 kind 的键/非对象 ⇒ null；非字符串值被丢弃", () => {
    expect(parseStructuredForKind("缺陷", { reproSteps: "1. 点\n2. 卡", expectedResult: " 能导出 " })).toEqual({ reproSteps: "1. 点\n2. 卡", expectedResult: "能导出" });
    expect(parseStructuredForKind("需求", { useScenario: "开会", priorityScope: "P2" })).toEqual({ useScenario: "开会", priorityScope: "P2" });
    expect(parseStructuredForKind("缺陷", { useScenario: "开会" })).toBeNull();
    expect(parseStructuredForKind("缺陷", {})).toBeNull();
    expect(parseStructuredForKind("缺陷", "x")).toBeNull();
    expect(parseStructuredForKind("缺陷", undefined)).toBeNull();
    expect(parseStructuredForKind("缺陷", { actualResult: 42, expectedResult: "ok" })).toEqual({ expectedResult: "ok" });
  });

  it("structureFeedbackDraft：模型给了 structured ⇒ 随结果返回；没给 ⇒ null，detail 仍完整", async () => {
    const mk = (text: string) => ({
      model: { complete: vi.fn(async () => ({ text })) } as never,
      structureModel: { provider: "p", modelId: "m" },
      log: vi.fn(),
    });
    const withFields = await structureFeedbackDraft(
      mk('{"kind":"缺陷","title":"导出卡住","detail":"导出 PDF 时卡住","structured":{"reproSteps":"1. 点导出\\n2. 等待","actualResult":"卡住"}}'),
      { transcript: "导出 PDF 时卡住" },
    );
    expect(withFields).toEqual({ kind: "缺陷", title: "导出卡住", detail: "导出 PDF 时卡住", structured: { reproSteps: "1. 点导出\n2. 等待", actualResult: "卡住" } });
    const without = await structureFeedbackDraft(mk('{"kind":"需求","title":"要导出","detail":"希望能导出"}'), { transcript: "希望能导出" });
    expect(without).toEqual({ kind: "需求", title: "要导出", detail: "希望能导出", structured: null });
  });
});

describe("deriveFeedbackTitle（服务端权威，与前端同一规则）", () => {
  it("首行 → 首句 → trim → ≤120；空正文 ⇒ null", () => {
    expect(deriveFeedbackTitle("  \n 导出按钮点了没反应。第二次也没反应\n更多")).toBe("导出按钮点了没反应");
    expect(deriveFeedbackTitle("no punctuation here")).toBe("no punctuation here");
    expect(deriveFeedbackTitle("！！！")).toBe("！！！");
    expect(deriveFeedbackTitle("x".repeat(200))).toHaveLength(120);
    expect(deriveFeedbackTitle("  \n\t ")).toBeNull();
  });
});
