/**
 * F56 / AC5 -- agent 模型下拉只出现 20-model 中已启用（且测试通过）的模型.
 *
 * `user_visible_behavior` 逐字：「agent 模型下拉只出现 20-model 中已启用模型」。
 *
 * ⚠ This is deliberately NOT a second filter implementation. `listAgentModelOptions`
 * (`application/agent/list-agent-model-options.ts`) is a one-line pin of `consumer: "agent"`
 * onto F50's `listSelectableModels` -- the bundle's single, three-times-reused candidate
 * filter. These tests exist to prove the agent surface actually calls that shared
 * implementation (and gets the shared answer), not to re-derive the filtering rule.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import { listAgentModelOptions } from "../../../src/application/agent/list-agent-model-options";
import type { SelectablePoolReader } from "../../../src/application/model/list-selectable-models";
import { MODEL_STATUSES, type ModelStatus } from "../../../src/domain/model/registry";
import type { SelectableCandidateRow } from "../../../src/domain/model/selectable";

function row(modelId: string, status: ModelStatus): SelectableCandidateRow {
  return {
    modelId,
    kind: "closed-api",
    shape: "single",
    status,
    complianceAttrs: [],
    members: [],
  };
}

function poolOf(rows: readonly SelectableCandidateRow[]): SelectablePoolReader {
  return { listCandidates: async () => rows };
}

describe("F56 -- agent 模型下拉：候选集恒等于 已启用 集合", () => {
  it("四态齐全的模型池 -> 下拉里只出现已启用的那一个（作为集合断言，不是计数）", () => {
    expect(MODEL_STATUSES).toEqual(["待测试", "已启用", "已停用", "依赖失败"]);
    const pool = poolOf(MODEL_STATUSES.map((status, i) => row(`m-${i}-${status}`, status)));
    return listAgentModelOptions("org-1", null, pool).then((result) => {
      expect(result.map((r) => r.modelId)).toEqual(["m-1-已启用"]);
    });
  });

  it("空池 -> 真实空数组，不预置默认候选", async () => {
    const result = await listAgentModelOptions("org-1", null, poolOf([]));
    expect(result).toEqual([]);
  });

  it("反向：全部已启用 -> 全部出现（不是「恒空」的实现）", async () => {
    const pool = poolOf([row("m-a", "已启用"), row("m-b", "已启用")]);
    const result = await listAgentModelOptions("org-1", null, pool);
    expect(result.map((r) => r.modelId).sort()).toEqual(["m-a", "m-b"]);
  });

  it("purpose = confidential 时收窄到 self-hosted——与 routeModelCall 同一判据，agent 侧不得放宽", async () => {
    const pool = poolOf([
      { ...row("m-closed", "已启用"), kind: "closed-api" as const },
      { ...row("m-local", "已启用"), kind: "self-hosted" as const },
    ]);
    const result = await listAgentModelOptions("org-1", "confidential", pool);
    expect(result.map((r) => r.modelId)).toEqual(["m-local"]);
  });

  it("契约层面：ModelConsumer 闭集里确有 agent 一员——本文件的 consumer 不是凭空造的字符串", () => {
    expect(A.ModelConsumer.options).toContain("agent");
  });

  it("组合模型任一成员停用 ⇒ 从 agent 下拉里整条退出，不降级为单模型静默出现（I-5）", async () => {
    const blockedCombo: SelectableCandidateRow = {
      modelId: "m-combo",
      kind: "closed-api",
      shape: "composite",
      status: "已启用",
      complianceAttrs: [],
      members: [
        { modelId: "m-whisper", role: "transcribe", kind: "self-hosted", status: "已启用", complianceAttrs: [] },
        { modelId: "m-sonnet", role: "write", kind: "closed-api", status: "已停用", complianceAttrs: [] },
      ],
    };
    const result = await listAgentModelOptions("org-1", null, poolOf([blockedCombo]));
    expect(result).toEqual([]);
  });
});
