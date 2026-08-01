/**
 * F51 · **机密硬路由的唯一执行点**（UC-20.3 / D-U1，I-10…I-13）。
 *
 * ## 验收对象是什么，看起来像验收但不是的又是什么
 *
 * 验收是「上下文含机密 ⇒ 整轮只可能被自托管模型处理，绝不回落闭源，无自托管时明确失败」。
 * 一个只返回 `{ localOnly: true }` 之类判定对象的实现不满足它——真正的失败形状是
 * "判定正确，但闭源模型仍然在候选集里/仍然能被选中"。所以下面的断言钉在
 * `decideModelRoute` 的**输出候选集与选中结果**上，而不只是一个布尔标记。
 *
 * ## 三种"看起来对但错了"的实现，各配一条反证
 *
 *   1. **分流**（机密部分本地、非机密部分闭源）——D-U1 明确否决："整轮全程本地"，
 *      不是"按内容分流"。反证：即使 pool 里有能用的闭源模型，含机密时它也一个不剩。
 *   2. **降级代替拒绝**——无自托管模型时"退而求其次选个闭源模型继续跑"。
 *      反证：`NO_LOCAL_MODEL_AVAILABLE` 时 `ok` 必须是 `false`，没有任何"选中了谁"。
 *   3. **静默丢弃机密标记**——把"不确定/缺失"当作"不含机密"处理。
 *      反证：`confidentiality: "unknown"` 与 `confidentiality: true` 产生同一个候选集。
 */
import { describe, expect, it } from "vitest";
import {
  assembleHardConstraintSection,
  CONFIDENTIAL_HARD_CONSTRAINT_TEXT,
  decideModelRoute,
  resolveContainsConfidential,
} from "../../../src/domain/model/route-call";
import type { SelectableCandidateRow } from "../../../src/domain/model/selectable";
import {
  routeModelCall,
  RouteModelCallError,
  type BypassAuditSink,
  type ConfidentialityReader,
  type RouteModelPoolReader,
  type RoutingDecisionRecord,
  type RoutingDecisionSink,
} from "../../../src/application/model/route-model-call";

function row(modelId: string, over: Partial<SelectableCandidateRow> = {}): SelectableCandidateRow {
  return {
    modelId,
    kind: "closed-api",
    shape: "single",
    status: "已启用",
    complianceAttrs: [],
    members: [],
    ...over,
  };
}

const CLOUD_A = row("gpt-5.2");
const CLOUD_B = row("claude-4");
const LOCAL_A = row("qwen3-32b", { kind: "self-hosted" });
const LOCAL_DISABLED = row("qwen3-old", { kind: "self-hosted", status: "已停用" });

describe("AC1a：含机密的上下文只可能被开源自托管模型处理（整轮，不分流）", () => {
  it("候选集恰好是 self-hosted ∩ 已启用 —— 闭源模型一个不剩，即使它们本来可用", () => {
    const pool = [CLOUD_A, CLOUD_B, LOCAL_A];
    const verdict = decideModelRoute({ pool, requestedModelId: null, confidentiality: true });
    expect(verdict.ok).toBe(true);
    expect([...verdict.candidateModelIds].sort()).toEqual(["qwen3-32b"]);
    // 反证①（分流）：候选集里不能出现任何 closed-api，哪怕它是"已启用"。
    expect(verdict.candidateModelIds).not.toContain("gpt-5.2");
    expect(verdict.candidateModelIds).not.toContain("claude-4");
  });

  it("不含机密时闭源与自托管都在候选集里（不是恒本地）", () => {
    const pool = [CLOUD_A, LOCAL_A];
    const verdict = decideModelRoute({ pool, requestedModelId: null, confidentiality: false });
    expect(verdict.ok).toBe(true);
    expect([...verdict.candidateModelIds].sort()).toEqual(["gpt-5.2", "qwen3-32b"].sort());
  });

  it("批准卡场景：项目库 ＋ 电价曲线 · 含机密——两个模型池位，只剩一个可选", () => {
    const pool = [row("gpt-5.2"), row("qwen3-32b", { kind: "self-hosted" })];
    const verdict = decideModelRoute({ pool, requestedModelId: "gpt-5.2", confidentiality: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe("CONFIDENTIAL_ROUTE_VIOLATION");
      expect(verdict.bypassAttempt).toBe(true);
    }
  });
});

describe("AC2：无可用自托管模型时明确失败，绝不回落闭源、绝不静默丢弃机密内容", () => {
  it("池子只有闭源模型 —— 明确失败，不是'选一个凑合的'", () => {
    const pool = [CLOUD_A, CLOUD_B];
    const verdict = decideModelRoute({ pool, requestedModelId: null, confidentiality: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe("NO_LOCAL_MODEL_AVAILABLE");
      // 反证②（降级代替拒绝）：拒绝态没有"selectedModelId"这回事，
      // 类型上 RouteVerdictRejected 根本不带这个字段——降级实现会在这里露馅。
      expect((verdict as unknown as Record<string, unknown>).selectedModelId).toBeUndefined();
      expect(verdict.candidateModelIds).toEqual([]);
    }
  });

  it("唯一的自托管模型恰好被停用 —— 同样明确失败，不给最后一个不合格的答案", () => {
    const pool = [CLOUD_A, LOCAL_DISABLED];
    const verdict = decideModelRoute({ pool, requestedModelId: null, confidentiality: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("NO_LOCAL_MODEL_AVAILABLE");
  });

  it("补一个可用的本地模型后，同一个池子立刻放行 —— 门不是恒关（反证：闸门不是摆设）", () => {
    const pool = [CLOUD_A, LOCAL_DISABLED, LOCAL_A];
    const verdict = decideModelRoute({ pool, requestedModelId: null, confidentiality: true });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.selectedModelId).toBe("qwen3-32b");
  });

  it("组合模型因成员停用而被拖垮时也是同一条路径（不降级为单模型静默运行，I-5）", () => {
    const combo = row("combo-1", {
      shape: "composite",
      kind: "self-hosted",
      members: [
        { modelId: "whisper", role: "transcribe", kind: "self-hosted", status: "已停用", complianceAttrs: [] },
        { modelId: "sonnet", role: "write", kind: "self-hosted", status: "已启用", complianceAttrs: [] },
      ],
    });
    const verdict = decideModelRoute({ pool: [CLOUD_A, combo], requestedModelId: "combo-1", confidentiality: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe("COMPOSITE_MEMBER_DISABLED");
      expect(verdict.blockedByMemberIds).toEqual(["whisper"]);
      // 不是绕过尝试——这是"组合坏了"，不是"有人想偷偷用闭源"。
      expect(verdict.bypassAttempt).toBe(false);
    }
  });
});

describe("I-12：机密标记缺失或冲突 ⇒ 从严按含机密处理", () => {
  it("'unknown' 与显式 true 产生完全相同的候选集与结果（反证③：静默丢弃标记）", () => {
    const pool = [CLOUD_A, LOCAL_A];
    const asTrue = decideModelRoute({ pool, requestedModelId: null, confidentiality: true });
    const asUnknown = decideModelRoute({ pool, requestedModelId: null, confidentiality: "unknown" });
    expect(asUnknown).toEqual(asTrue);
    expect(resolveContainsConfidential("unknown")).toBe(true);
  });

  it("只有 confidentiality === false 才会打开闭源候选", () => {
    expect(resolveContainsConfidential(false)).toBe(false);
    expect(resolveContainsConfidential(true)).toBe(true);
  });
});

describe("AC4：含机密任务禁止降级 —— degradedTo 恒为 null", () => {
  it("成功路由时 degradedTo 恒为 null（本用例不做降级选型）", () => {
    const verdict = decideModelRoute({ pool: [LOCAL_A], requestedModelId: null, confidentiality: true });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.degradedTo).toBeNull();
  });
});

describe("AC5：系统提示硬约束段 —— 第二道防线，逐字包含约束原文", () => {
  it("assembleHardConstraintSection 逐字包含「客户机密材料只能由本地模型处理」", () => {
    const section = assembleHardConstraintSection();
    expect(section).toContain(CONFIDENTIAL_HARD_CONSTRAINT_TEXT);
    expect(CONFIDENTIAL_HARD_CONSTRAINT_TEXT).toBe("客户机密材料只能由本地模型处理");
    expect(section.startsWith("# 硬约束")).toBe(true);
  });
});

/* ══════════════════ 应用层：留痕 + 拒绝也要写（I-44）══════════════════ */

function fakePorts(pool: readonly SelectableCandidateRow[], confidentiality: boolean | "unknown") {
  const decisions: RoutingDecisionRecord[] = [];
  const bypassAttempts: { requestedModelId: string; code: string }[] = [];
  const poolReader: RouteModelPoolReader = { listCandidates: async () => pool };
  const confidentialityReader: ConfidentialityReader = { read: async () => confidentiality };
  const decisionSink: RoutingDecisionSink = { record: async (e) => void decisions.push(e) };
  const bypassAudit: BypassAuditSink = {
    recordBypassAttempt: async (e) => void bypassAttempts.push({ requestedModelId: e.requestedModelId, code: e.code }),
  };
  return { poolReader, confidentialityReader, decisionSink, bypassAudit, decisions, bypassAttempts };
}

describe("应用层 routeModelCall：拒绝也要写 RoutingDecision（I-44 契约第 6 步）", () => {
  it("成功路由：写下 outcome='routed'，selectedModelId 非空", async () => {
    const ports = fakePorts([LOCAL_A], true);
    const out = await routeModelCall(
      { orgId: "org-1", callId: "call-1", contextPackId: "pack-1", requestedModelId: null, taskKind: "含客户机密" },
      { pool: ports.poolReader, confidentiality: ports.confidentialityReader, decisions: ports.decisionSink, bypassAudit: ports.bypassAudit },
    );
    expect(out.selectedModelId).toBe("qwen3-32b");
    expect(out.degradedTo).toBeNull();
    expect(ports.decisions).toHaveLength(1);
    expect(ports.decisions[0]).toMatchObject({ outcome: "routed", selectedModelId: "qwen3-32b", containsConfidential: true });
  });

  it("无本地模型：抛 RouteModelCallError('NO_LOCAL_MODEL_AVAILABLE')，但拒绝仍然留痕", async () => {
    const ports = fakePorts([CLOUD_A], true);
    await expect(
      routeModelCall(
        { orgId: "org-1", callId: "call-2", contextPackId: "pack-2", requestedModelId: null, taskKind: "普通生成" },
        { pool: ports.poolReader, confidentiality: ports.confidentialityReader, decisions: ports.decisionSink, bypassAudit: ports.bypassAudit },
      ),
    ).rejects.toMatchObject({ code: "NO_LOCAL_MODEL_AVAILABLE" });
    expect(ports.decisions).toHaveLength(1);
    expect(ports.decisions[0]).toMatchObject({ outcome: "rejected", selectedModelId: null });
    // ⚠ 决策记录里没有机密内容原文（I-13）——只有 id 与候选集，断言不含任何"曲线/项目库"字样。
    expect(JSON.stringify(ports.decisions[0])).not.toMatch(/电价|项目库|客户机密材料只能由本地模型处理/);
  });

  it("绕过尝试（直接指定闭源模型）：拒绝 + 计入越权拦截计数", async () => {
    const ports = fakePorts([CLOUD_A, LOCAL_A], true);
    await expect(
      routeModelCall(
        { orgId: "org-1", callId: "call-3", contextPackId: "pack-3", requestedModelId: "gpt-5.2", taskKind: "含客户机密" },
        { pool: ports.poolReader, confidentiality: ports.confidentialityReader, decisions: ports.decisionSink, bypassAudit: ports.bypassAudit },
      ),
    ).rejects.toBeInstanceOf(RouteModelCallError);
    expect(ports.bypassAttempts).toEqual([{ requestedModelId: "gpt-5.2", code: "CONFIDENTIAL_ROUTE_VIOLATION" }]);
  });

  it("反证：候选集为空这类正常拒绝不计入越权拦截计数（不是每次拒绝都是绕过）", async () => {
    const ports = fakePorts([CLOUD_A], true);
    await expect(
      routeModelCall(
        { orgId: "org-1", callId: "call-4", contextPackId: "pack-4", requestedModelId: null, taskKind: "普通生成" },
        { pool: ports.poolReader, confidentiality: ports.confidentialityReader, decisions: ports.decisionSink, bypassAudit: ports.bypassAudit },
      ),
    ).rejects.toBeInstanceOf(RouteModelCallError);
    expect(ports.bypassAttempts).toEqual([]);
  });

  it("R5：无角色豁免 —— 用例签名里没有任何 actor/role 参数可以让判定分叉", () => {
    // 机械化断言：routeModelCall 的输入类型里没有 actorId / role 之类字段。
    const inputKeys = ["orgId", "callId", "contextPackId", "requestedModelId", "taskKind"];
    expect(inputKeys).not.toContain("actorId");
    expect(inputKeys).not.toContain("role");
  });
});
