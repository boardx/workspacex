import { describe, expect, it } from "vitest";
import { executedViaKernelRuntime, routeCapabilityRun } from "../../src/application/agent-run/capability-runtime-routing";
import type { AgentRunStore, ClaimedAgentRun, ModelCallPort } from "../../src/application/agent-run/ports";
import { RoutingModelCallPort } from "../../src/infrastructure/agent-run/routing-model-call-port";
import { pinnedModelConfig } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { kernelServedProviders } from "../../src/infrastructure/agent-run/loopback-provider-aliases";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-x");
const base = { runId: "r1", modelProvider: "dashscope", modelId: "qwen-plus", skillVersionIds: [] as string[] } as unknown as ClaimedAgentRun;
const store = (allowlist: string[] | null, agentPinnedSkillCount = 0): AgentRunStore => ({
  readRunWorkflowContext: async () => allowlist === null ? null
    : { agentId: "a", agentVersionId: "v", workflowAllowlist: allowlist, requesterUserId: null, agentPinnedSkillCount },
}) as unknown as AgentRunStore;
const served: ModelCallPort = { complete: async () => ({ text: "" }), servesViaKernelRuntime: (p) => p === "dashscope" };

describe("routeCapabilityRun（数字人能力，决策 B）", () => {
  it("dashscope + 白名单 ⇒ deep-agent，模型保持钉住值", async () => {
    const run = await routeCapabilityRun({ model: served, runs: store(["W027"]) }, ORG, base);
    expect({ p: run.modelProvider, m: run.modelId }).toEqual({ p: "deep-agent", m: "qwen-plus" });
  });
  it("dashscope + Agent 版本自己钉了 Skill ⇒ deep-agent", async () => {
    const run = await routeCapabilityRun({ model: served, runs: store([], 1) }, ORG, { ...base, skillVersionIds: ["s1"] });
    expect(run.modelProvider).toBe("deep-agent");
  });
  it("回归（core-loop 8b）：run 只因并入组织已启用 Skill 而有 skillVersionIds，Agent 自身无能力 ⇒ 原样", async () => {
    const withOrgSkills = { ...base, skillVersionIds: ["org-enabled-1"] } as ClaimedAgentRun;
    expect(await routeCapabilityRun({ model: served, runs: store([], 0) }, ORG, withOrgSkills)).toBe(withOrgSkills);
  });
  it("普通 Agent（无白名单、无 Skill）/ 读不到上下文 ⇒ 原样", async () => {
    expect(await routeCapabilityRun({ model: served, runs: store([]) }, ORG, base)).toBe(base);
    expect(await routeCapabilityRun({ model: served, runs: store(null) }, ORG, base)).toBe(base);
  });
  it("内核端点不提供该 provider（或端口未声明）⇒ 原样", async () => {
    const plain: ModelCallPort = { complete: async () => ({ text: "" }) };
    expect(await routeCapabilityRun({ model: plain, runs: store(["W027"]) }, ORG, base)).toBe(base);
    const other = { ...base, modelProvider: "openai" } as ClaimedAgentRun;
    expect(await routeCapabilityRun({ model: served, runs: store(["W027"]) }, ORG, other)).toBe(other);
  });
  it("RoutingModelCallPort.servesViaKernelRuntime：需在集合内且注册了 deep-agent", () => {
    const p: ModelCallPort = { complete: async () => ({ text: "" }) };
    expect(new RoutingModelCallPort(new Map([["dashscope", p], ["deep-agent", p]]), new Set(["dashscope"])).servesViaKernelRuntime("dashscope")).toBe(true);
    expect(new RoutingModelCallPort(new Map([["dashscope", p]]), new Set(["dashscope"])).servesViaKernelRuntime("dashscope")).toBe(false);
    expect(new RoutingModelCallPort(new Map([["dashscope", p], ["deep-agent", p]])).servesViaKernelRuntime("dashscope")).toBe(false);
  });
  it("pinnedModelConfig：路由标签 deep-agent 不送，具体模型送 model_id", () => {
    expect(pinnedModelConfig({ modelId: "deep-agent" })).toEqual({});
    expect(pinnedModelConfig({ modelId: "qwen-plus" })).toEqual({ model_id: "qwen-plus" });
  });
  it("kernelServedProviders：deep-agent 端口不可用（base url 为空）⇒ 空集 ⇒ 不改路由，走旧的 dashscope 路径", async () => {
    expect([...kernelServedProviders("dashscope", ["x"], "")]).toEqual([]);
    expect([...kernelServedProviders("dashscope", ["x"], "http://k")]).toEqual(["dashscope", "x"]);
    const router = new RoutingModelCallPort(new Map<string, ModelCallPort>([["dashscope", served], ["deep-agent", served]]), kernelServedProviders("dashscope", [], ""));
    expect(await routeCapabilityRun({ model: router, runs: store(["W027"]) }, ORG, base)).toBe(base);
  });
  it("executedViaKernelRuntime（恢复判据）", () => {
    const s = new Set(["dashscope"]);
    expect(executedViaKernelRuntime({ modelProvider: "deep-agent", kernelServedProviders: new Set(), skillCount: 0, workflowAllowlistCount: 0 })).toBe(true);
    expect(executedViaKernelRuntime({ modelProvider: "dashscope", kernelServedProviders: s, skillCount: 0, workflowAllowlistCount: 1 })).toBe(true);
    expect(executedViaKernelRuntime({ modelProvider: "dashscope", kernelServedProviders: s, skillCount: 0, workflowAllowlistCount: 0 })).toBe(false);
    expect(executedViaKernelRuntime({ modelProvider: "dashscope", kernelServedProviders: new Set(), skillCount: 2, workflowAllowlistCount: 0 })).toBe(false);
  });
});
