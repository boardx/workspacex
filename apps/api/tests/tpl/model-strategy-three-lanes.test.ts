import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  validateModelStrategy,
  type ModelStrategyLanes,
} from "../../src/domain/templates/model-strategy";
import type { SelectableCandidateRow } from "../../src/domain/model/selectable";

/**
 * F20 —— **三条按场景分派的模型策略**（`uc-2-1` R3 步骤 5 / R7「模型与配额」/ V10）。
 *
 * 「三条策略并存，非全局单选」——本文件的第一组用例就是拿**同一个候选池**验三条
 * lane，逐条断言它们各自落到自己配的模型，而不是被合并成一个全局选择。
 *
 * ⚠ 判定顺序也是契约行为：没启用报 `MODEL_NOT_ENABLED`，已启用但机密 lane 选了
 * 非本地模型报 `CONFIDENTIAL_ROUTE_VIOLATION`——两者不是同一个码，混用会让界面把
 * 「压根没这个模型」和「隐私硬路由违规」显示成同一句话。
 */

function row(
  modelId: string,
  kind: "self-hosted" | "closed-api",
  status: "已启用" | "已停用" | "待测试" = "已启用",
): SelectableCandidateRow {
  return {
    modelId,
    kind,
    shape: "single",
    status,
    complianceAttrs: [],
    members: [],
  };
}

const pool: SelectableCandidateRow[] = [
  row("sonnet-4.6", "closed-api"),
  row("opus-4.6", "closed-api"),
  row("qwen3-local", "self-hosted"),
  row("disabled-model", "self-hosted", "已停用"),
];

const validLanes: ModelStrategyLanes = {
  onsite: "sonnet-4.6",
  postSession: "opus-4.6",
  confidential: "qwen3-local",
};

describe("三条 lane 各自分派、互不覆盖", () => {
  it("现场 / 会后整理 / 机密材料三条都合法 ⇒ 放行", () => {
    expect(validateModelStrategy(validLanes, pool)).toEqual({ ok: true });
  });

  it("三条 lane 可以配成互不相同的模型 —— 不是全局单选折叠成一个", () => {
    const verdict = validateModelStrategy(
      { onsite: "sonnet-4.6", postSession: "opus-4.6", confidential: "qwen3-local" },
      pool,
    );
    expect(verdict.ok).toBe(true);
    // 反证：把三条都配成同一个自托管模型也应放行（三条策略互相独立，不禁止相同）。
    expect(
      validateModelStrategy(
        { onsite: "qwen3-local", postSession: "qwen3-local", confidential: "qwen3-local" },
        pool,
      ).ok,
    ).toBe(true);
  });

  it("现场 lane 选了未启用模型 ⇒ MODEL_NOT_ENABLED，且指出是哪条 lane", () => {
    const verdict = validateModelStrategy({ ...validLanes, onsite: "disabled-model" }, pool);
    expect(verdict).toEqual({
      ok: false,
      code: "MODEL_NOT_ENABLED",
      lane: "onsite",
      modelId: "disabled-model",
    });
  });

  it("会后整理 lane 选了压根不存在的模型 ⇒ MODEL_NOT_ENABLED", () => {
    const verdict = validateModelStrategy({ ...validLanes, postSession: "no-such-model" }, pool);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("MODEL_NOT_ENABLED");
    expect(verdict.ok === false && verdict.lane).toBe("postSession");
  });

  it("机密材料 lane 选了已启用的云端模型 ⇒ CONFIDENTIAL_ROUTE_VIOLATION（不是 MODEL_NOT_ENABLED）", () => {
    const verdict = validateModelStrategy({ ...validLanes, confidential: "sonnet-4.6" }, pool);
    expect(verdict).toEqual({
      ok: false,
      code: "CONFIDENTIAL_ROUTE_VIOLATION",
      lane: "confidential",
      modelId: "sonnet-4.6",
    });
  });
});

describe("被拒时用的是契约里已有的那个码", () => {
  it("MODEL_NOT_ENABLED / CONFIDENTIAL_ROUTE_VIOLATION 都是 setModelStrategy 的失败面成员", () => {
    expect(templates.TemplateError.safeParse("MODEL_NOT_ENABLED").success).toBe(true);
    expect(templates.TemplateError.safeParse("CONFIDENTIAL_ROUTE_VIOLATION").success).toBe(true);
    expect(templates.operations.setModelStrategy.err).toContain("MODEL_NOT_ENABLED");
    expect(templates.operations.setModelStrategy.err).toContain("CONFIDENTIAL_ROUTE_VIOLATION");
    // 反向：契约确实会拒绝一个不存在的码，否则上面两条可能在空转
    expect(templates.TemplateError.safeParse("MODEL_ROUTE_DENIED").success).toBe(false);
  });

  it("ModelStrategy 的三条 lane 名字与契约一致（onsite / postSession / confidential）", () => {
    expect(templates.ModelLane.options).toEqual(["onsite", "postSession", "confidential"]);
    const parsed = templates.ModelStrategy.safeParse(validLanes);
    expect(parsed.success).toBe(true);
  });
});
