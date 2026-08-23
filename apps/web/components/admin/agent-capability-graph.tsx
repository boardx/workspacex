"use client";

/**
 * #1911 —— Agent 详情页「能力图」只读视图。挂在 `capability-edit-page.tsx` 的
 * `renderEditExtra` 注入点（`agent/[id]/page.tsx` 传入），与 `agent-screen.tsx` /
 * `capability-edit-page.tsx` 已有的路由/鉴权路径完全复用，不新开第二条。
 *
 * 数据来自真实接口：
 * · `getAgentCapabilityGraph`（`GET /agents/:agentId`，#1911 新增的只读操作，
 *   读 `agents.skill_mounts`/`agents.tool_whitelist` 两列，见其契约头注）
 * · `listCapabilities(orgId, "skill")`（既有真实接口）补 skill 展示名——拿不到就
 *   原样退回 skillId，不臆造名字。
 *
 * MCP 侧不依赖 `listMcpServers`/`listMcpTools`——那两个契约操作目前零后端实现
 * （见 `agent-capability-graph-model.ts` 与 issue #1911 evidence 里的勘探记录），
 * 节点标签从 `toolWhitelist[].toolFullName` 自解析（`parseMcpToolFullName`）。
 *
 * 范围边界：只读。没有任何「新增关系」的界面——见 `agent-capability-graph-canvas.tsx`
 * 头注对 `nodesConnectable={false}` 的说明。
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { AlertTriangle } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { getAgentCapabilityGraph, type AgentCapabilityGraphOut } from "@/lib/live-agent-capability-graph";
import { listCapabilities } from "@/lib/live-capabilities";
import { buildAgentCapabilityGraphModel } from "@/lib/agent-capability-graph-model";

const AgentCapabilityGraphCanvas = dynamic(() => import("./agent-capability-graph-canvas"), {
  ssr: false,
  loading: () => (
    <div
      className="grid h-[420px] w-full place-items-center rounded-lg border border-dashed border-border text-11 text-muted-foreground"
      data-testid="agent-capability-graph-loading"
    >
      能力图加载中…
    </div>
  ),
});

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: AgentCapabilityGraphOut; readonly skillNames: Map<string, string> };

export function AgentCapabilityGraph({ orgId, agentId }: { orgId: string; agentId: string }) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  const load = React.useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [data, skills] = await Promise.all([
        getAgentCapabilityGraph(agentId),
        // Skill 目录读失败不该拖垮整张图——图仍然能用 skillId 兜底展示。
        listCapabilities(orgId, "skill").catch(() => []),
      ]);
      const skillNames = new Map(skills.map((s) => [s.id, s.name]));
      setState({ status: "ready", data, skillNames });
    } catch (error) {
      setState({ status: "error", message: describeError(error) });
    }
  }, [orgId, agentId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-2" data-testid="agent-capability-graph">
      <div className="flex items-center justify-between">
        <h2 className="text-14 font-semibold">能力图</h2>
        <span className="text-10 text-muted-foreground">只读 · 挂载的 Skill 与可调用的 MCP 工具</span>
      </div>

      {state.status === "loading" ? (
        <div
          data-testid="agent-capability-graph-loading-state"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          正在读取能力图…
        </div>
      ) : null}

      {state.status === "error" ? (
        <div
          data-testid="agent-capability-graph-error"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-12 text-destructive"
        >
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          能力图读取失败：{state.message}
        </div>
      ) : null}

      {state.status === "ready" ? <ReadyGraph agentId={agentId} state={state} /> : null}
    </section>
  );
}

function ReadyGraph({
  agentId,
  state,
}: {
  agentId: string;
  state: Extract<LoadState, { status: "ready" }>;
}) {
  const model = buildAgentCapabilityGraphModel(state.data, state.skillNames);

  if (!model.hasCapabilities) {
    return (
      <div
        data-testid="agent-capability-graph-empty"
        className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
      >
        还没有挂载任何能力——这个 Agent 目前没有挂载 Skill，也没有被授权调用任何 MCP 工具。
      </div>
    );
  }

  return (
    <AgentCapabilityGraphCanvas
      agentId={agentId}
      agentLabel={model.agentLabel}
      skillNodes={model.skillNodes}
      mcpNodes={model.mcpNodes}
    />
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
