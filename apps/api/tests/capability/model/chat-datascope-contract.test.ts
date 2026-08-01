/**
 * F51 · 后端硬路由与前端批准卡纯函数**行为一致**（uc-20-3 notes：批准卡与对话"更多设置"
 * 共用的纯函数 `dataScopeConstraint` / `modelPolicyViolation` / `isModelSelectable`
 * ——`apps/web/lib/mock/chat.ts`——是要落成真实后端规则的契约）。
 *
 * ## 为什么不是"重新实现一遍前端逻辑再互相比对"
 *
 * 前端那三个纯函数已经是**产品承诺的落地版本**（批准卡 UI 已建成、三个 data-testid 已存在）。
 * 本文件的职责只有一件事：证明 `decideModelRoute`（后端唯一执行点）在同一组场景下，
 * 与前端纯函数给出**同一个答案**——而不是各自实现、恰好在少数几个例子上凑巧一致。
 * 直接 `import` 前端源码（而非在这里手抄一份"预期值"）正是为了避免"抄错一份"本身
 * 制造出第三份漂移的事实源。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideModelRoute } from "../../../src/domain/model/route-call";
import type { SelectableCandidateRow } from "../../../src/domain/model/selectable";

const WEB_CHAT_MOCK = new URL("../../../../web/lib/mock/chat.ts", import.meta.url);

type ChatMock = typeof import("../../../../web/lib/mock/chat");

async function loadChatMock(): Promise<ChatMock> {
  return import("../../../../web/lib/mock/chat");
}

function row(modelId: string, hosting: "cloud" | "local"): SelectableCandidateRow {
  return {
    modelId,
    kind: hosting === "cloud" ? "closed-api" : "self-hosted",
    shape: "single",
    status: "已启用",
    complianceAttrs: [],
    members: [],
  };
}

describe("dataScopeConstraint（前端）与 decideModelRoute（后端）对同一份 dataScope 意见一致", () => {
  it("含机密 ⇒ 两侧都判定为全程本地", async () => {
    const { dataScopeConstraint } = await loadChatMock();
    const scope = [
      { id: "d1", label: "项目库", confidential: false },
      { id: "d2", label: "电价曲线", confidential: true },
    ];
    const front = dataScopeConstraint(scope);
    expect(front.localModelOnly).toBe(true);

    const back = decideModelRoute({
      pool: [row("gpt-5.2", "cloud"), row("qwen3-32b", "local")],
      requestedModelId: null,
      confidentiality: front.localModelOnly,
    });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.candidateModelIds).toEqual(["qwen3-32b"]);
  });

  it("不含机密 ⇒ 两侧都判定为可用云端", async () => {
    const { dataScopeConstraint } = await loadChatMock();
    const scope = [{ id: "d1", label: "公开材料", confidential: false }];
    const front = dataScopeConstraint(scope);
    expect(front.localModelOnly).toBe(false);

    const back = decideModelRoute({
      pool: [row("gpt-5.2", "cloud"), row("qwen3-32b", "local")],
      requestedModelId: null,
      confidentiality: front.localModelOnly,
    });
    expect(back.ok).toBe(true);
    if (back.ok) expect([...back.candidateModelIds].sort()).toEqual(["gpt-5.2", "qwen3-32b"].sort());
  });
});

describe("modelPolicyViolation（前端）与 CONFIDENTIAL_ROUTE_VIOLATION（后端）判同一批模型集违规", () => {
  it("含机密却混入云端模型 —— 前端报违规，后端拒绝该云端模型", async () => {
    const { modelPolicyViolation } = await loadChatMock();
    const dataScope = [{ id: "d1", label: "电价曲线", confidential: true }];
    const models = [
      { id: "gpt-5.2", label: "gpt-5.2", hosting: "cloud" as const, version: "v1" },
      { id: "qwen3-32b", label: "本地 qwen3-32b", hosting: "local" as const, version: "v1" },
    ];
    expect(modelPolicyViolation(models, dataScope)).not.toBeNull();

    const back = decideModelRoute({
      pool: [row("gpt-5.2", "cloud"), row("qwen3-32b", "local")],
      requestedModelId: "gpt-5.2",
      confidentiality: true,
    });
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.code).toBe("CONFIDENTIAL_ROUTE_VIOLATION");
  });

  it("含机密且只有本地模型 —— 两侧都合规/放行", async () => {
    const { modelPolicyViolation } = await loadChatMock();
    const dataScope = [{ id: "d1", label: "电价曲线", confidential: true }];
    const models = [{ id: "qwen3-32b", label: "本地 qwen3-32b", hosting: "local" as const, version: "v1" }];
    expect(modelPolicyViolation(models, dataScope)).toBeNull();

    const back = decideModelRoute({
      pool: [row("qwen3-32b", "local")],
      requestedModelId: "qwen3-32b",
      confidentiality: true,
    });
    expect(back.ok).toBe(true);
  });

  it("含机密但一个本地模型都没有 —— 前端报违规，后端 NO_LOCAL_MODEL_AVAILABLE", async () => {
    const { modelPolicyViolation } = await loadChatMock();
    const dataScope = [{ id: "d1", label: "电价曲线", confidential: true }];
    const models = [{ id: "gpt-5.2", label: "gpt-5.2", hosting: "cloud" as const, version: "v1" }];
    expect(modelPolicyViolation(models, dataScope)).not.toBeNull();

    const back = decideModelRoute({ pool: [row("gpt-5.2", "cloud")], requestedModelId: null, confidentiality: true });
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.code).toBe("NO_LOCAL_MODEL_AVAILABLE");
  });
});

describe("isModelSelectable（前端 `[改]` 面板置灰判据）与后端候选集口径一致", () => {
  it("含机密时，云端模型在前端不可选、在后端候选集里也不存在", async () => {
    const { isModelSelectable } = await loadChatMock();
    const dataScope = [{ id: "d1", label: "电价曲线", confidential: true }];
    const cloudModel = { id: "gpt-5.2", label: "gpt-5.2", hosting: "cloud" as const, version: "v1" };
    const localModel = { id: "qwen3-32b", label: "本地 qwen3-32b", hosting: "local" as const, version: "v1" };

    expect(isModelSelectable(cloudModel, dataScope).ok).toBe(false);
    expect(isModelSelectable(localModel, dataScope).ok).toBe(true);

    const back = decideModelRoute({
      pool: [row("gpt-5.2", "cloud"), row("qwen3-32b", "local")],
      requestedModelId: null,
      confidentiality: true,
    });
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.candidateModelIds).not.toContain("gpt-5.2");
      expect(back.candidateModelIds).toContain("qwen3-32b");
    }
  });

  it("不含机密时，前端两个模型都可选，后端候选集也都在", async () => {
    const { isModelSelectable } = await loadChatMock();
    const dataScope: { id: string; label: string; confidential: boolean }[] = [];
    const cloudModel = { id: "gpt-5.2", label: "gpt-5.2", hosting: "cloud" as const, version: "v1" };
    const localModel = { id: "qwen3-32b", label: "本地 qwen3-32b", hosting: "local" as const, version: "v1" };
    expect(isModelSelectable(cloudModel, dataScope).ok).toBe(true);
    expect(isModelSelectable(localModel, dataScope).ok).toBe(true);

    const back = decideModelRoute({
      pool: [row("gpt-5.2", "cloud"), row("qwen3-32b", "local")],
      requestedModelId: null,
      confidentiality: false,
    });
    expect(back.ok).toBe(true);
    if (back.ok) expect([...back.candidateModelIds].sort()).toEqual(["gpt-5.2", "qwen3-32b"].sort());
  });
});

describe("单一事实源守卫：批准卡组件真的调用这三个纯函数，没有另写一份规则", () => {
  it("approval-card.tsx 从 lib/mock/chat.ts import 三个纯函数，不自造判定", () => {
    const path = fileURLToPath(new URL("../../../../web/components/chat/approval-card.tsx", import.meta.url));
    const body = readFileSync(path, "utf8");
    expect(body).toMatch(/dataScopeConstraint/);
    expect(body).toMatch(/modelPolicyViolation/);
    // 手抄的迹象：组件里直接判断 hosting === "cloud" 而不经由纯函数
    const codeLines = body.split("\n").filter((l) => !/^\s*(\*|\/\/|\{\/\*)/.test(l));
    const offenders = codeLines.filter((l) => /localModelOnly\s*&&.*hosting\s*===\s*"cloud"/.test(l));
    expect(offenders).toEqual([]);
  });

  it("chat.ts 本身存在且导出的是这三个函数（防止路径漂移导致本文件恒真）", async () => {
    const body = readFileSync(WEB_CHAT_MOCK, "utf8");
    expect(body).toMatch(/export function dataScopeConstraint/);
    expect(body).toMatch(/export function modelPolicyViolation/);
    expect(body).toMatch(/export function isModelSelectable/);
  });
});
