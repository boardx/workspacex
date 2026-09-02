"use client";

import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { CapabilityListing } from "@/lib/live-capabilities";

/**
 * issue #2130（TW-P0-2，回指 #2068）—— 「选择能力」的六项披露卡片列表 + 承载它的浮层。
 *
 * ## 2026-09-02 composer 三层结构重设计：本文件不再自带触发按钮
 *
 * 此前这里是"一颗带文字的胶囊触发器 + 它下面的卡片列表"。触发入口现在是 composer
 * 「+」菜单里的一项（`chat-task-workbench-composer-menu.tsx`，testid
 * `chat-task-workbench-capability-picker` 与 `data-auto-match` 都搬到那一项上），选中后
 * 以第 1 层状态 chip 露出（`chat-task-workbench-composer-capability-chip`）。本文件只剩
 * 两件事：`CapabilityCardList`（纯列表，六项披露的唯一实现）与 `CapabilityPopover`
 * （挂在互斥槽 `chat-capability-picker` 上的浮层壳：定位 + outside-click / Escape）。
 * 卡片本身的 testid / data 属性逐字不动。
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

/**
 * 见文件头「记忆范围」一节的裁决理由，唯一事实源在这里，不在别处重复声明。
 * `_SHORT` 是卡片压缩排版里实际显示的文案；完整解释放进该 span 的 `title`
 * （鼠标悬停可见），不再常驻占一整行。
 */
const MEMORY_SCOPE_SHORT_LABEL = "仅本对话";
const MEMORY_SCOPE_FULL_LABEL = "记忆范围：仅本对话（本仓当前无跨线程记忆机制）";

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

export interface CapabilityCardListProps {
  readonly listings: readonly CapabilityListing[];
  /** `null` = 未手选（默认自动匹配服务端配置的默认 agent，见判据 TW-P0-2①）。 */
  readonly selectedAgentId: string | null;
  readonly onSelect: (agentId: string) => void;
  /** 当前实际在对话的那个 agent 的真实运行态；只在它等于某张卡片时用于覆盖 "ready"。 */
  readonly acting?: CapabilityCardActingState | null;
}

/** 六项披露卡片列表（`role="listbox"`）。不管开合，谁承载它谁决定。 */
export function CapabilityCardList({ listings, selectedAgentId, onSelect, acting = null }: CapabilityCardListProps): JSX.Element {
  return (
    <div
      role="listbox"
      aria-label="选择能力"
      /* issue #2130 —— 保留既有 e2e（`copilotkit-v2-agent-switch.spec.ts`，
         issue #2023）依赖的下拉容器锚点名，这里只是同一个下拉换了皮肤。 */
      data-testid="chat-agent-select-listbox"
      className="flex max-h-96 w-80 flex-col gap-1 overflow-y-auto p-1.5"
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
            onClick={() => onSelect(listing.id)}
            className={[
              "flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected ? "border-primary/60 text-primary" : "border-transparent text-card-foreground",
            ].join(" ")}
          >
            <span className="flex items-center gap-1.5">
              <Avatar initials={abbrFor(listing)} tone="ai" size="xs" />
              <span className="truncate text-12 font-medium">{listing.name}</span>
            </span>
            <span
              className="truncate text-11 text-muted-foreground"
              title={strengths}
              data-testid="chat-task-workbench-capability-facet-strengths"
            >
              {strengths}
            </span>
            {/*
              issue #2340 → 2026-08-30 二次压缩（人类反馈「agent 列表太长」）——
              此前「工具/材料/写权限」占一整行，「记忆范围」「当前状态」各占一整行，
              一张卡视觉上仍有 5 行。六项披露的「签核判据」只要求六个 testid 各自
              `toBeVisible()`（`e2e/chat-task-workbench-capability-cards.spec.ts`
              TW-P0-2②），没有要求各占一行——这里把「工具/材料/写权限」的免责声明
              与「记忆范围」「当前状态」三样合并到同一条 flex-wrap 行内，用极短的
              标签词代替整句话，六个 `data-testid`／`data-memory-scope`／
              `data-status` 原样保留，只是排版从 3 行收进 1 行。
            */}
            <span className="flex flex-wrap items-baseline gap-x-1 text-10 text-muted-foreground">
              <span data-testid="chat-task-workbench-capability-facet-tools">工具</span>
              <span aria-hidden>/</span>
              <span data-testid="chat-task-workbench-capability-facet-materials">材料</span>
              <span aria-hidden>/</span>
              <span data-testid="chat-task-workbench-capability-facet-writes">写权限</span>
              <span>未披露</span>
              <span aria-hidden>·</span>
              <span
                data-testid="chat-task-workbench-capability-facet-memory"
                data-memory-scope="thread"
                title={MEMORY_SCOPE_FULL_LABEL}
              >
                记忆{MEMORY_SCOPE_SHORT_LABEL}
              </span>
              <span aria-hidden>·</span>
              <span data-testid="chat-task-workbench-capability-facet-status" data-status={cardStatus}>
                {statusLabel(cardStatus)}
                {!listing.enabled && listing.disabledReason ? `（${listing.disabledReason}）` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 与 composer「+」菜单共用的开合口：菜单项点它，浮层就接过 `activeId`。 */
export function useCapabilityPopoverSlot(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  return useChatPopoverSlot("chat-capability-picker");
}

/**
 * 能力列表的浮层壳。`absolute` 贴着最近的定位祖先（composer 第二行左侧那组的
 * `relative` 容器）向上开——与「+」菜单、技能候选浮层三者从同一个角落弹出，
 * 用户视觉上只有"一个地方会弹东西"。
 *
 * 没有触发器，因此 outside-click 只看浮层自己：打开它的那一下 mousedown 发生在
 * 菜单项上、发生在监听挂上之前，不会被误判成"点外面"。
 */
export function CapabilityPopover({
  listings,
  status,
  selectedAgentId,
  onSelect,
  acting = null,
}: {
  readonly listings: readonly CapabilityListing[] | null;
  readonly status: "loading" | "error" | "ready";
  readonly selectedAgentId: string | null;
  readonly onSelect: (agentId: string) => void;
  readonly acting?: CapabilityCardActingState | null;
}): JSX.Element | null {
  const [open, setOpen] = useCapabilityPopoverSlot();
  const containerRef = React.useRef<HTMLDivElement>(null);

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

  if (!open || status !== "ready" || listings === null) return null;
  return (
    <div
      ref={containerRef}
      data-testid="chat-task-workbench-capability-popover"
      className="absolute bottom-full left-0 z-20 mb-1.5 rounded-lg border border-border bg-popover shadow-md"
    >
      <CapabilityCardList
        listings={listings}
        selectedAgentId={selectedAgentId}
        acting={acting}
        onSelect={(agentId) => { onSelect(agentId); setOpen(false); }}
      />
    </div>
  );
}

/** 供状态 chip 使用：与卡片头像同一套缩写规则，不在 composer 里再抄一份。 */
export { abbrFor as capabilityAbbrFor };
