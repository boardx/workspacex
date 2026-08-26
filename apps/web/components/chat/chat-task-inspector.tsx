"use client";
import * as React from "react";
import { ListChecks, FolderOpen, Package, Settings2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatMaterialsPanel } from "@/components/chat/chat-materials-panel";
import { AgentPlanPanel, type PlanTodo } from "@/components/chat/agent-plan-panel";
import {
  INSPECTOR_TABS,
  isInspectorCollapsed,
  nextInspectorTab,
  type InspectorSignals,
  type InspectorTab,
} from "@/lib/chat-task-inspector-tabs";
import type { ListThreadArtifactsOut, ListThreadAttachmentsOut } from "@/lib/live-chat";

/**
 * issue #2068（TW-P0-4）—— 右栏动态 Inspector。
 *
 * ## 它替换掉了什么
 *
 * `copilotkit-v2-shell.tsx` 此前的右栏是**固定两段竖直堆叠**（产物在上、材料在下），
 * 没有页签、没有「进度」、没有「运行详情」、不会按阶段切换、空态也常驻占 w-72。
 * 人类 2026-08-26 审计原话：「不许常驻占六分之一屏」。
 *
 * ## 折叠态不是"藏起来"，是**换一种形态**
 *
 * 折叠时渲染的是一条 w-10 的竖向图标页签栏——四个页签**仍然可见、仍然是 role=tab**，
 * 点任意一个就展开。整条栏 40px，远低于 1280 视口的 1/12（106px）。
 * 做成"完全消失 + 一个孤零零的展开按钮"会把"现在没内容"变成"这里什么都没有"，
 * 用户不知道右栏存在过——那是把占屏问题换成了发现性问题。
 *
 * ## 「进度」页签里放什么（issue #2068 第一件：把计划状态接进活体面板）
 *
 * `write_todos` 的结构化计划早就在 wire 上（`copilotkit-agui.controller.ts` 的
 * `STATE_SNAPSHOT`），消费 hook（`lib/agui-plan-todos.ts`）与渲染组件
 * （`agent-plan-panel.tsx`）也都在 main 上——此前只接在预览面板
 * （`copilotkit-preview-panel.tsx`），活体面板从没接过。这里是它的活体落点。
 *
 * ⚠ **只做「读」这半边。** 计划的可编辑（调顺序 / 删步骤 / 加约束，验收卡 TW-P0-3③）
 * 当前**没有任何写入通路**：`mutateThread.in.op` 是封闭枚举 `["create","rename","delete"]`
 * （`packages/contracts/src/chat.ts`，已签契约），无路由、无表、无读模型。做一个纯前端
 * 的"删了就没了、下一帧快照一到又回来"的按钮，正是本仓验收卡反伪造条款判 0 的那种
 * 假按钮。因此 `chat-task-workbench-plan-step-{reorder,delete}` /
 * `-plan-add-constraint` 三个锚点**故意不实现**，TW-P0-3③ 继续红着——那是如实的
 * 差距信号，不是遗漏。
 */

export interface ChatTaskInspectorProps {
  readonly hasSelection: boolean;
  readonly threadId: string | null;
  readonly artifacts: ListThreadArtifactsOut | null;
  readonly materials: ListThreadAttachmentsOut | null;
  readonly loading: boolean;
  readonly artifactsError: string | null;
  readonly materialsError: string | null;
  readonly onRetry: () => void;
  /** 已上传但还没随消息发出的材料条数（composer 附件区），与已落库材料一起算「材料」。 */
  readonly pendingMaterialsCount: number;
  /** `STATE_SNAPSHOT` 解析出的计划快照；null = 本轮还没有计划。 */
  readonly planTodos: readonly PlanTodo[] | null;
  readonly isRunning: boolean;
  /** 当前阶段文案（`copilotkit-v2-run-progress.ts`），无可翻译事件时为 null。 */
  readonly runPhaseLabel: string | null;
  /** `RUN_STARTED` 时刻（epoch ms）；秒数在本组件内派生——见 panel 侧同名 prop 的注释：
   *  每秒变一次的值不上抛，重渲染只落在这棵子树上。 */
  readonly runStartedAt: number | null;
}

const TAB_META: Record<InspectorTab, { label: string; Icon: typeof ListChecks }> = {
  progress: { label: "进度", Icon: ListChecks },
  materials: { label: "材料", Icon: FolderOpen },
  artifacts: { label: "产物", Icon: Package },
  "run-details": { label: "运行详情", Icon: Settings2 },
};

export function ChatTaskInspector(props: ChatTaskInspectorProps): JSX.Element {
  const {
    hasSelection, threadId, artifacts, materials, loading,
    artifactsError, materialsError, onRetry, pendingMaterialsCount,
    planTodos, isRunning, runPhaseLabel, runStartedAt,
  } = props;

  /** ⚠ 计时器只在真的有一轮在跑时才起（同 `copilotkit-v2-run-progress.ts` 的纪律）：
   *  常驻 `setInterval` 会让完全空闲的页面每秒重渲染一次右栏。 */
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (runStartedAt === null) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [runStartedAt]);
  const runElapsedSeconds = runStartedAt === null
    ? null
    : Math.floor(Math.max(0, nowTick - runStartedAt) / 1_000);

  const materialsCount = (materials?.items.length ?? 0) + pendingMaterialsCount;
  const artifactsCount = artifacts?.items.length ?? 0;
  const signals: InspectorSignals = React.useMemo(
    () => ({ materialsCount, artifactsCount, isRunning }),
    [materialsCount, artifactsCount, isRunning],
  );

  const [activeTab, setActiveTab] = React.useState<InspectorTab>("progress");
  /** 用户手动展开过就不再自动折叠回去——折叠是"没内容"的默认值，不是一道锁。 */
  const [manuallyExpanded, setManuallyExpanded] = React.useState(false);

  const prevSignalsRef = React.useRef<InspectorSignals | null>(null);
  React.useEffect(() => {
    const prev = prevSignalsRef.current;
    prevSignalsRef.current = signals;
    setActiveTab((current) => nextInspectorTab(prev, signals, current));
  }, [signals]);

  const hasPlan = planTodos !== null && planTodos.length > 0;
  const hasRunDetails = runPhaseLabel !== null || runElapsedSeconds !== null;
  const collapsed = !manuallyExpanded && isInspectorCollapsed(signals, hasPlan, hasRunDetails);

  const selectTab = React.useCallback((tab: InspectorTab) => {
    setActiveTab(tab);
    setManuallyExpanded(true);
  }, []);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-l border-border bg-card md:flex",
        collapsed ? "w-10" : "w-72",
      )}
      data-testid="chat-task-workbench-inspector"
      data-collapsed={collapsed ? "true" : "false"}
      data-active-tab={activeTab}
      aria-label="任务检查器"
    >
      <div
        role="tablist"
        aria-orientation={collapsed ? "vertical" : "horizontal"}
        aria-label="任务检查器页签"
        className={cn(
          "flex shrink-0 border-b border-border-subtle",
          collapsed ? "flex-col items-center gap-0.5 py-1.5" : "flex-row items-stretch",
        )}
      >
        {INSPECTOR_TABS.map((tab) => {
          const { label, Icon } = TAB_META[tab];
          const selected = tab === activeTab && !collapsed;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              /* 折叠态图标按钮没有可见文本，读屏必须另有名字（TW-A11Y 同源要求）。 */
              aria-label={label}
              title={label}
              data-testid={`chat-task-workbench-inspector-tab-${tab}`}
              onClick={() => selectTab(tab)}
              className={cn(
                "flex items-center justify-center gap-1 text-11 transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed ? "h-7 w-7 rounded-md" : "min-w-0 flex-1 px-1 py-2",
                selected
                  ? "bg-muted font-medium text-card-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-card-foreground",
              )}
            >
              <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
              {collapsed ? null : <span className="truncate">{label}</span>}
            </button>
          );
        })}
        {collapsed ? null : (
          <button
            type="button"
            aria-label="收起任务检查器"
            aria-expanded
            title="收起任务检查器"
            data-testid="chat-task-workbench-inspector-collapse"
            onClick={() => setManuallyExpanded(false)}
            className="flex w-7 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-fast hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelRightClose aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {collapsed ? (
        <div className="flex flex-1 items-start justify-center pt-1">
          <button
            type="button"
            aria-label="展开任务检查器"
            aria-expanded={false}
            title="展开任务检查器"
            data-testid="chat-task-workbench-inspector-expand"
            onClick={() => setManuallyExpanded(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelRightOpen aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          role="tabpanel"
          aria-label={TAB_META[activeTab].label}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {activeTab === "progress" ? (
            <ProgressTab
              planTodos={planTodos}
              isRunning={isRunning}
              runPhaseLabel={runPhaseLabel}
              runElapsedSeconds={runElapsedSeconds}
            />
          ) : activeTab === "materials" ? (
            <ChatMaterialsPanel
              hasSelection={hasSelection}
              threadId={threadId}
              materials={materials}
              loading={loading}
              error={materialsError}
              onRetry={onRetry}
              uploadCtl={null}
            />
          ) : activeTab === "artifacts" ? (
            <ChatArtifactsPanel
              hasSelection={hasSelection}
              artifacts={artifacts}
              loading={loading}
              error={artifactsError}
              onRetry={onRetry}
            />
          ) : (
            <RunDetailsTab
              threadId={threadId}
              isRunning={isRunning}
              runPhaseLabel={runPhaseLabel}
              runElapsedSeconds={runElapsedSeconds}
            />
          )}
        </div>
      )}
    </aside>
  );
}

/**
 * 「进度」页签 —— 计划快照（读）+ 步骤级完成比例。
 *
 * ⚠ 完成比例读的是 todo 的 `status`，不是任何前端定时器推算出来的百分比：
 * 验收卡 TW-P0-3⑤ 的"完成比例"指的就是步骤级比例（那一节明确写了它不是单次
 * 工具调用的在途态——人类 2026-08-10 已裁决不做那个）。
 */
function ProgressTab({
  planTodos, isRunning, runPhaseLabel, runElapsedSeconds,
}: {
  planTodos: readonly PlanTodo[] | null;
  isRunning: boolean;
  runPhaseLabel: string | null;
  runElapsedSeconds: number | null;
}) {
  const todos = planTodos !== null && planTodos.length > 0 ? planTodos : null;
  if (todos === null && !isRunning) {
    return (
      <p className="px-3 py-3 text-11 text-muted-foreground" data-testid="chat-task-workbench-inspector-progress-empty">
        还没有进行中的任务。描述一个目标，Agent 会先列出计划，这里会实时显示每一步的进展。
      </p>
    );
  }
  const done = todos === null ? 0 : todos.filter((t) => t.status === "completed").length;
  return (
    <div className="flex flex-col gap-2 p-2">
      {runPhaseLabel !== null || runElapsedSeconds !== null ? (
        <p className="px-1 text-11 text-muted-foreground" data-testid="chat-task-workbench-inspector-progress-phase">
          {runPhaseLabel ?? "正在处理…"}
          {runElapsedSeconds !== null ? ` · 已用 ${runElapsedSeconds} 秒` : ""}
        </p>
      ) : null}
      {todos === null ? (
        <p className="px-1 text-11 text-muted-foreground">Agent 正在理解目标，计划出来后会显示在这里。</p>
      ) : (
        <>
          <p className="px-1 text-11 font-medium text-card-foreground" data-testid="chat-task-workbench-plan-ratio">
            已完成 {done}/{todos.length} 步
          </p>
          <AgentPlanPanel
            steps={[]}
            stateSnapshotTodos={[...todos]}
            panelTestId="chat-task-workbench-plan-panel"
            stepTestId="chat-task-workbench-plan-step"
          />
        </>
      )}
    </div>
  );
}

/**
 * 「运行详情」页签 —— 技术信息的收纳处（验收卡 TW-P0-2③：模型名 / middleware /
 * LangGraph 节点这类词不出现在主界面，收进这里）。
 *
 * ⚠ 本轮只放**当前真实拿得到**的三样：线程 id、当前阶段、已耗时。模型 id、
 * middleware 链、LangGraph 节点在 v2 的 AG-UI 事件流里**没有真实数据源**
 * （`lib/copilotkit-v2-run-progress.ts` 文件头已逐维核实过一次同样的边界），
 * 不为了把这一页填满而编造。
 */
function RunDetailsTab({
  threadId, isRunning, runPhaseLabel, runElapsedSeconds,
}: {
  threadId: string | null;
  isRunning: boolean;
  runPhaseLabel: string | null;
  runElapsedSeconds: number | null;
}) {
  const rows: readonly (readonly [string, string])[] = [
    ["对话标识", threadId ?? "尚未创建"],
    ["运行状态", isRunning ? "运行中" : "空闲"],
    ["当前阶段", runPhaseLabel ?? "—"],
    ["本轮已用", runElapsedSeconds !== null ? `${runElapsedSeconds} 秒` : "—"],
  ];
  return (
    <dl className="flex flex-col gap-1.5 p-3 text-11" data-testid="chat-task-workbench-inspector-run-details">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-w-0 items-baseline justify-between gap-2">
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate text-right text-card-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
