"use client";

import * as React from "react";
import { listCapabilities, type CapabilityListing } from "@/lib/live-capabilities";
import type { GetAgentPanelOut } from "@/lib/live-chat";

/**
 * 2026-08-30（引用文件规模纪律拆分）—— 本文件从 `copilotkit-v2-panel.tsx` 拆出，
 * 只是搬家：`useCopilotKitV2AgentOptions` 是一个纯粹的"读组织 agent 目录"数据源
 * hook，不闭包依赖 `CopilotKitV2PanelBody` 的任何内部状态，天然可独立成文件。
 * 原文件当时已过 2000 行的业务源文件规模上限（AGENTS.md 硬约束）。行为逐字节
 * 未变，唯一改动是文件边界与 import 路径。
 *
 * issue #2023 —— agent 候选列表的数据源。逐字复用
 * `personal-chat-screen.tsx` 的 `useOrgAgentOptions`/`toAgentOption`（同一个
 * `listCapabilities(orgId, "agent")` 读端口、同一份"只取 `enabled` 条目"的过滤规则）
 * ——本文件不 import 那个组件内部的私有 hook（它没有导出，且那个文件是另一条并行
 * 任务同时在改的高冲突文件，见 issue #2023 描述的"文件冲突预期"），在这里独立写一份
 * 小的等价实现，不是重新设计一套不同的读法。
 */
export type CopilotKitV2AgentOptionsState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string; readonly retry: () => void }
  | { readonly status: "ready"; readonly agents: GetAgentPanelOut["agents"]; readonly listings: readonly CapabilityListing[] };

/**
 * issue #2130（TW-P0-2，回指 #2068）—— 修掉一个真实 bug：`duty` 此前被硬编码成
 * 「组织已配置 Agent」这句与具体 agent 无关的假文案，`CapabilityListing.duty` 这个
 * 真实、非空（DB CHECK 强制）的字段从未被读过。能力卡的「擅长什么」披露
 * （`chat-task-workbench-capability-picker.tsx`）现在直接消费原始 `CapabilityListing`，
 * 这里的 `duty` 只保留给仍然依赖 `GetAgentPanelOut["agents"]` 形状的既有调用方
 * （`actingAgentLabel` 等），一并修正，不留一个只有一处读、一处不读的半修状态。
 */
export function copilotkitV2ToAgentOption(row: CapabilityListing): GetAgentPanelOut["agents"][number] {
  const trimmedName = row.name.trim();
  const abbrSource = (row.abbr ?? "").trim() || trimmedName || row.id;
  const duty = (row.duty ?? "").trim() || "该 Agent 尚未填写擅长领域说明";
  return {
    id: row.id,
    abbr: abbrSource.slice(0, 2).toUpperCase(),
    name: trimmedName || row.id,
    duty,
    roleLabel: duty,
    presence: "present",
  };
}

export function useCopilotKitV2AgentOptions(orgId: string | null, bearer: string | null): CopilotKitV2AgentOptionsState {
  const sourceKey = orgId && bearer ? `${orgId} ${bearer}` : null;
  const [result, setResult] = React.useState<{ key: string; agents: GetAgentPanelOut["agents"]; listings: readonly CapabilityListing[] } | null>(null);
  const [failure, setFailure] = React.useState<{ key: string; message: string } | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!orgId || !bearer || !sourceKey) return;
    const key = sourceKey;
    const gen = ++generation.current;
    setFailure(null);
    try {
      const rows = await listCapabilities(orgId, "agent");
      if (gen !== generation.current) return;
      const enabled = rows.filter((row) => row.enabled);
      setResult({ key, agents: enabled.map(copilotkitV2ToAgentOption), listings: rows });
    } catch (err) {
      if (gen !== generation.current) return;
      setResult(null);
      setFailure({ key, message: err instanceof Error ? err.message : "读取组织 agent 目录失败" });
    }
  }, [orgId, bearer, sourceKey]);

  React.useEffect(() => {
    if (sourceKey) void load();
    return () => {
      generation.current += 1;
    };
  }, [load, sourceKey]);

  if (!sourceKey) return { status: "loading" };
  if (failure?.key === sourceKey) return { status: "error", message: failure.message, retry: () => void load() };
  if (result?.key === sourceKey) return { status: "ready", agents: result.agents, listings: result.listings };
  return { status: "loading" };
}
