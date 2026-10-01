/**
 * #4227 —— `wx_cite`：模型声明的引用必须经服务端重读校验才进 run 账本；写回时编号 1..n。
 * 反证：不在可见范围的 id / 别的组织的 id 被拒；重复引用折叠；工具登记为 L0（只记账，无外部副作用）。
 */
import { describe, expect, it, vi } from "vitest";
import { CiteInput } from "@repo/contracts/standard-context-tools";
import { citeSources, numberRunCitations, type RunCitation, type RunCitationLedger } from "../../src/application/agent-run/standard-cite";
import type { StandardKnowledgeSource, TrustedContextActor } from "../../src/application/agent-run/standard-context-tools";
import { NATIVE_PROFILE_TOOLS, nativeInterruptOn } from "../../src/application/agent-run/native-invocation";
import { classifyToolRisk, RISK_TIER_WHITELISTS } from "../../src/domain/agent-run/tool-risk-tier";
import { toOrgId } from "../../src/domain/org-id";

const ORG_A = toOrgId("org-a");
const actor: TrustedContextActor = { orgId: ORG_A, userId: "u1", threadId: "t1", projectId: null };

/** 来源按组织归属；read 只认 actor.orgId（与真实 source 同：组织来自受信回调，不来自参数）。 */
const SOURCES: Record<string, { org: string; version: string; title: string; content: string; artifactId: string; page: string }> = {
  "segment:s1": { org: "org-a", version: "v1", title: "季度报告.pdf", content: "Revenue grew 12% in Q3.", artifactId: "art-1", page: "3" },
  "segment:s2": { org: "org-a", version: "v2", title: "访谈纪要", content: "客户希望更快交付。", artifactId: "art-2", page: "1" },
  "segment:foreign": { org: "org-b", version: "v9", title: "别人的机密", content: "secret", artifactId: "art-b", page: "1" },
};

function knowledge() {
  const read = vi.fn(async (a: TrustedContextActor, input: { sourceId: string; versionId: string }) => {
    const s = SOURCES[input.sourceId];
    if (!s || s.org !== a.orgId || s.version !== input.versionId) throw new Error("context_source_unavailable");
    return {
      sourceId: input.sourceId, sourceVersion: s.version, content: s.content, title: s.title,
      citationAnchor: {
        kind: "indexed-segment" as const, segmentId: input.sourceId.slice(8), artifactId: s.artifactId,
        artifactVersionId: "av", projectId: null, anchor: { kind: "page" as const, locator: s.page },
      },
      accessibleAt: new Date().toISOString(), truncated: false, contentKind: "indexed-segment" as const,
    };
  });
  const source: StandardKnowledgeSource = { search: vi.fn(), read };
  return { source, read };
}

function ledger(active = true) {
  const store: RunCitation[] = [];
  let calls = 0;
  const l: RunCitationLedger = {
    async appendRunCitations(_org, _run, items) {
      calls++;
      if (!active) return null;
      for (const i of items) if (!store.some(s => s.key === i.key)) store.push(i);
      return store.map(s => s.key);
    },
  };
  return { l, store, calls: () => calls };
}

describe("wx_cite · 服务端校验", () => {
  it("不在可见范围的 id（编造的 / 本 run 读不到的）被拒，账本不写", async () => {
    const k = knowledge(), g = ledger();
    const out = await citeSources({ knowledge: k.source, ledger: g.l }, actor, "run-1",
      CiteInput.parse({ citations: [{ sourceId: "segment:made-up", versionId: "v1" }] }));
    expect(out).toEqual({ accepted: [], rejected: [{ sourceId: "segment:made-up", reason: "source_not_visible" }] });
    expect(g.calls()).toBe(0);
  });

  it("版本不一致（来源已改版）被拒", async () => {
    const out = await citeSources({ knowledge: knowledge().source, ledger: ledger().l }, actor, "run-1",
      CiteInput.parse({ citations: [{ sourceId: "segment:s1", versionId: "stale" }] }));
    expect(out.rejected).toEqual([{ sourceId: "segment:s1", reason: "source_not_visible" }]);
  });

  it("跨组织 id 被拒；重读用的是受信 actor 的组织", async () => {
    const k = knowledge(), g = ledger();
    const out = await citeSources({ knowledge: k.source, ledger: g.l }, actor, "run-1", CiteInput.parse({ citations: [
      { sourceId: "segment:foreign", versionId: "v9" }, { sourceId: "segment:s1", versionId: "v1" },
    ] }));
    expect(out.rejected).toEqual([{ sourceId: "segment:foreign", reason: "source_not_visible" }]);
    expect(out.accepted).toEqual([{ index: 1, sourceId: "segment:s1", sourceFullName: "季度报告.pdf" }]);
    expect(k.read.mock.calls.every(([a]) => a.orgId === ORG_A)).toBe(true);
    expect(g.store.map(s => s.sourceArtifactId)).toEqual(["art-1"]);
  });

  it("引用原文不在来源里 ⇒ quote_not_found；锚点缺省时从来源锚点推出页码", async () => {
    const g = ledger();
    const out = await citeSources({ knowledge: knowledge().source, ledger: g.l }, actor, "run-1", CiteInput.parse({ citations: [
      { sourceId: "segment:s1", versionId: "v1", quote: "revenue   GREW 12%" },
      { sourceId: "segment:s2", versionId: "v2", quote: "编造的一句话" },
    ] }));
    expect(out.rejected).toEqual([{ sourceId: "segment:s2", reason: "quote_not_found" }]);
    expect(g.store[0]).toMatchObject({ anchorKind: "page", anchorPage: 3, anchorRange: null, anchorMessageId: null });
  });

  it("锚点形态与字段不匹配 ⇒ anchor_invalid", async () => {
    const out = await citeSources({ knowledge: knowledge().source, ledger: ledger().l }, actor, "run-1",
      CiteInput.parse({ citations: [{ sourceId: "segment:s1", versionId: "v1", anchor: { kind: "transcript", page: 2 } }] }));
    expect(out.rejected).toEqual([{ sourceId: "segment:s1", reason: "anchor_invalid" }]);
  });

  it("重复引用折叠：同一次调用内、跨两次调用都只记一条，编号稳定", async () => {
    const k = knowledge(), g = ledger();
    const one = { sourceId: "segment:s1", versionId: "v1", anchor: { kind: "page" as const, page: 3 } };
    const first = await citeSources({ knowledge: k.source, ledger: g.l }, actor, "run-1", CiteInput.parse({ citations: [one, one] }));
    expect(first.accepted).toEqual([{ index: 1, sourceId: "segment:s1", sourceFullName: "季度报告.pdf" }]);
    const second = await citeSources({ knowledge: k.source, ledger: g.l }, actor, "run-1",
      CiteInput.parse({ citations: [{ sourceId: "segment:s2", versionId: "v2" }, one] }));
    expect(second.accepted.map(a => a.index)).toEqual([2, 1]);
    expect(g.store).toHaveLength(2);
  });

  it("run 已不在 running ⇒ 全部 run_not_active，不假装记下", async () => {
    const out = await citeSources({ knowledge: knowledge().source, ledger: ledger(false).l }, actor, "run-1",
      CiteInput.parse({ citations: [{ sourceId: "segment:s1", versionId: "v1" }] }));
    expect(out).toEqual({ accepted: [], rejected: [{ sourceId: "segment:s1", reason: "run_not_active" }] });
  });

  it("工具参数里不许夹带 artifact id / 组织（strict schema）", () => {
    expect(CiteInput.safeParse({ citations: [{ sourceId: "segment:s1", versionId: "v1", sourceArtifactId: "art-b" }] }).success).toBe(false);
    expect(CiteInput.safeParse({ citations: [{ sourceId: "segment:s1", versionId: "v1" }], orgId: "org-b" }).success).toBe(false);
    expect(CiteInput.safeParse({ citations: [] }).success).toBe(false);
  });
});

describe("写回编号 numberRunCitations", () => {
  const c = (key: string): RunCitation => ({
    key, sourceFullName: key, anchorKind: "page", anchorPage: 1, anchorRange: null, anchorMessageId: null, sourceArtifactId: null,
  });
  it("折叠重复 key，按首次出现编号 1..n；空/历史行 ⇒ []", () => {
    expect(numberRunCitations([c("a"), c("b"), c("a"), c("c")]).map(x => [x.index, x.sourceFullName]))
      .toEqual([[1, "a"], [2, "b"], [3, "c"]]);
    expect(numberRunCitations(null)).toEqual([]);
  });
});

describe("wx_cite 在副作用分级闭集里", () => {
  it("显式登记为 L0、在原生准入表里、不打断", () => {
    expect(RISK_TIER_WHITELISTS.L0.has("wx_cite")).toBe(true);
    expect(RISK_TIER_WHITELISTS.L1.has("wx_cite") || RISK_TIER_WHITELISTS.L2.has("wx_cite")).toBe(false);
    expect(classifyToolRisk("wx_cite")).toBe("L0");
    expect(NATIVE_PROFILE_TOOLS).toContain("wx_cite");
    expect(nativeInterruptOn().wx_cite).toBe(false);
  });
});
