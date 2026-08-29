"use client";

import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { CapabilityListing } from "@/lib/live-capabilities";

/**
 * issue #2130（TW-P0-2，回指 #2068）—— 「选择能力」入口 + 六项披露卡片。
 *
 * ## 为什么是新组件，不是原地改 `AgentPicker`
 *
 * `AgentPicker`（`chat-composer-pickers.tsx`）是一个**裸下拉**，被
 * `personal-chat-screen.tsx`/`chat-read-screen.tsx`/`chat-skill-mount-panel.tsx`
 * 等多处复用，形状是"选项只有名字"。TW-P0-2 要求的是完全不同的交互（默认自动匹配、
 * 每项展开成六件披露的卡片），原地改会改变那几个无关调用方的行为。这里独立写一份，
 * 数据源仍是同一条 `listCapabilities(orgId, "agent")`（由调用方 `copilotkit-v2-panel.tsx`
 * 读取后把原始 `CapabilityListing[]` 传进来，不在这里重新发请求）。
 *
 * ## 六项披露的范围裁决（issue #2130 已在开工前逐项 grep 确认，写在这里作为唯一事实源）
 *
 * - 「擅长什么」—— `CapabilityListing.duty`，真实字段，非空（DB CHECK
 *   `capability_listings_agent_needs_abbr_duty` 强制）。
 * - 「可用工具与技能」「能读哪些材料」「是否写文件/调外部服务」—— **后端契约
 *   （`packages/contracts/src/identity.ts` 的 `CapabilityListing`）与
 *   `apps/deep-agent-service` 均无对应字段**（issue #2130 开工前 grep 零命中）。
 *   如实标注「暂缺该项披露」，不编造数据——这是本仓反伪造条款的直接要求。
 * - 「记忆范围」—— 全仓当前**没有**跨线程/长期记忆机制（同样已 grep 确认），
 *   因此对全部能力恒为「仅本对话」：这是一个架构级事实，不是编的组织配置，
 *   日后接上跨线程记忆时需要回来改这里的常量。
 * - 「当前状态」—— 真实可计算：`enabled=false` → "failed"（原因取
 *   `disabledReason`，真实字段）；是当前选中且正在对话的那个 agent → 用真实
 *   `agent.isRunning`/`isReady` 派生；其余 → "ready"（这句话本身是真的：
 *   一个 `enabled` 的能力现在就可以被选中使用）。
 */

export type CapabilityCardStatus = "ready" | "running" | "awaiting-approval" | "failed";

export interface CapabilityCardActingState {
  readonly agentId: string;
  readonly status: CapabilityCardStatus;
}

/** 见文件头「记忆范围」一节的裁决理由，唯一事实源在这里，不在别处重复声明。 */
const MEMORY_SCOPE_LABEL = "仅本对话（本仓当前无跨线程记忆机制）";

function statusLabel(status: CapabilityCardStatus): string {
  switch (status) {
    case "ready": return "就绪";
    case "running": return "运行中";
    case "awaiting-approval": return "等待审批";
    case "failed": return "不可用";
    default: return status;
  }
}

function abbrFor(listing: CapabilityListing): string {
  const trimmed = (listing.abbr ?? "").trim();
  if (trimmed) return trimmed.slice(0, 2).toUpperCase();
  const name = listing.name.trim() || listing.id;
  return name.slice(0, 2).toUpperCase();
}

export function CapabilityPicker({
  listings,
  status,
  selectedAgentId,
  onSelect,
  disabled,
  side = "up",
  acting = null,
}: {
  listings: readonly CapabilityListing[] | null;
  status: "loading" | "error" | "ready";
  /** `null` = 未手选（默认自动匹配服务端配置的默认 agent，见判据 TW-P0-2①）。 */
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
  disabled: boolean;
  side?: "up" | "down";
  /** 当前实际在对话的那个 agent 的真实运行态；只在它等于某张卡片时用于覆盖 "ready"。 */
  acting?: CapabilityCardActingState | null;
}): JSX.Element {
  const [open, setOpen] = useChatPopoverSlot("chat-capability-picker");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const selected = listings?.find((l) => l.id === selectedAgentId) ?? null;
  const autoMatch = selectedAgentId === null;

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <div ref={containerRef} className="relative flex items-center">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="max-w-56 justify-start gap-1.5 rounded-pill px-2"
        data-testid="chat-task-workbench-capability-picker"
        data-auto-match={autoMatch ? "true" : "false"}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择能力"
        title={selected ? `选择能力：${selected.name}` : "选择能力（默认自动匹配）"}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? <Avatar initials={abbrFor(selected)} tone="ai" size="xs" /> : null}
        <span className="truncate text-11">
          {selected ? `能力：${selected.name}` : "选择能力（自动匹配）"}
        </span>
        <span aria-hidden className="text-9 text-muted-foreground">▾</span>
      </Button>
      {open && status === "ready" && listings ? (
        <div
          role="listbox"
          aria-label="选择能力"
          /* issue #2130 —— 保留既有 e2e（`copilotkit-v2-agent-switch.spec.ts`，
             issue #2023）依赖的下拉容器锚点名，这里只是同一个下拉换了皮肤。 */
          data-testid="chat-agent-select-listbox"
          className={`absolute ${side === "down" ? "top-8" : "bottom-8"} left-0 z-10 flex max-h-96 w-80 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-md`}
        >
          {listings.length === 0 ? (
            <p className="px-2 py-2 text-11 text-muted-foreground">这个组织还没有可用的能力。</p>
          ) : null}
          {listings.map((listing) => {
            const isSelected = listing.id === selectedAgentId;
            const cardStatus: CapabilityCardStatus = !listing.enabled
              ? "failed"
              : (acting && acting.agentId === listing.id ? acting.status : "ready");
            const strengths = (listing.duty ?? "").trim() || "该 Agent 尚未填写擅长领域说明";
            return (
              <button
                key={listing.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid="chat-task-workbench-capability-card"
                /* issue #2130 —— TW-P0-2 判据要求全部卡片共用同一个字面量
                   testid（每张能力卡是"一个可重复的锚点"，不是各带一份 id）；
                   `copilotkit-v2-agent-switch.spec.ts`（issue #2023）需要按真实
                   agent id 精确点中某一张卡，`data-testid` 单值装不下两个诉求，
                   这里用一个独立的 `data-agent-id` 承载后者——不是新发明一套
                   命名规范，只是同一个真实按钮多一个可查询属性。 */
                data-agent-id={listing.id}
                onClick={() => { onSelect(listing.id); setOpen(false); }}
                className={[
                  "flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected ? "border-primary/60 text-primary" : "border-transparent text-card-foreground",
                ].join(" ")}
              >
                <span className="flex items-center gap-1.5">
                  <Avatar initials={abbrFor(listing)} tone="ai" size="xs" />
                  <span className="truncate text-12 font-medium">{listing.name}</span>
                </span>
                <span className="text-11 text-muted-foreground" data-testid="chat-task-workbench-capability-facet-strengths">
                  擅长：{strengths}
                </span>
                {/*
                  issue #2340 —— 三项「暂缺该项披露」原先各占一整行、逐字重复同一句免责文案，
                  视觉噪音大（人类反馈「描述太长，要简化」）。这里只做**视觉**合并：三项仍是三个
                  独立 `data-testid`（`e2e/chat-task-workbench-capability-cards.spec.ts`，issue #2068
                  已签核判据要求三项分别可见），免责文案只在行尾说一次，不再逐项重复。
                */}
                <span className="flex flex-wrap items-baseline gap-x-1 text-11 text-muted-foreground">
                  <span data-testid="chat-task-workbench-capability-facet-tools">可用工具与技能</span>
                  <span aria-hidden>／</span>
                  <span data-testid="chat-task-workbench-capability-facet-materials">能读哪些材料</span>
                  <span aria-hidden>／</span>
                  <span data-testid="chat-task-workbench-capability-facet-writes">是否写文件/调外部服务</span>
                  <span>：均暂未披露（后端目前未提供）</span>
                </span>
                <span
                  className="text-11 text-muted-foreground"
                  data-testid="chat-task-workbench-capability-facet-memory"
                  data-memory-scope="thread"
                >
                  记忆范围：{MEMORY_SCOPE_LABEL}
                </span>
                <span
                  className="text-11 text-muted-foreground"
                  data-testid="chat-task-workbench-capability-facet-status"
                  data-status={cardStatus}
                >
                  当前状态：{statusLabel(cardStatus)}
                  {!listing.enabled && listing.disabledReason ? `（${listing.disabledReason}）` : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
