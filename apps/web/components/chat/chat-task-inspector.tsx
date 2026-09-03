"use client";
import * as React from "react";
import { ListChecks, FolderOpen, Package, Settings2, Users, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatMaterialsPanel } from "@/components/chat/chat-materials-panel";
import { RosterPanel, type RosterPanelProps } from "@/components/chat/chat-roster-panel";
import { AgentPlanPanel, type PlanTodo } from "@/components/chat/agent-plan-panel";
import {
  INSPECTOR_TABS,
  isInspectorCollapsed,
  nextInspectorTab,
  type InspectorSignals,
  type InspectorTab,
} from "@/lib/chat-task-inspector-tabs";
import type { ListThreadArtifactsOut, ListThreadAttachmentsOut } from "@/lib/live-chat";
import { usePlanLedgerPolling } from "@/lib/use-plan-ledger-polling";

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
 * ⚠ **issue #2260 更正：计划快照的权威数据源改成账本，不是 AG-UI SSE 快照。**
 * `planTodos`（父组件订阅 `useAguiPlanTodos` 的 `STATE_SNAPSHOT`）只在**实时
 * AG-UI 桥**这一条通路上更新——`confirmPlan`/`resumePlanRun`/`retryPlanStep`
 * 触发的续跑（issue #2250）走的是 queued/tick 通路，对浏览器不可见
 * （`accept-message-plan-run-creator.ts` 头注），永远不会推一次新的
 * `STATE_SNAPSHOT`。于是「确认并执行」之后，本页签曾经停在确认前的旧计划
 * 快照上，而顶部阶段指示器（`copilotkit-v2-plan-control.tsx`，读同一张账本）
 * 正确跟着 run 推进到 `完成`——两处矛盾。账本（`getPlanLedger`）在两条通路上
 * 都会被写入（`ingestEnginePlanSnapshot` 的两个调用点），因此改为本组件也
 * `usePlanLedgerPolling(threadId)` 读同一张账本；账本有步骤时优先于
 * `planTodos`（后者只作为账本还没取到第一帧时的短暂占位，不再是稳态来源）。
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
  /** issue #2099 —— 产物条目点击回调；不传时「产物」页签的条目诚实退回不可点
   *  （见 `ChatArtifactsPanel` 自己的 `onOpen` 可选约定），不是这里另造一条规则。 */
  readonly onOpenArtifact?: (item: ListThreadArtifactsOut["items"][number]) => void;
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
  /**
   * PROP-CHAT-UIUX-ITER-002 V3 —— composer「任务模式」开关的真实状态（`false` =
   * 问答模式，`true` = 先计划后执行），透传自 `copilotkit-v2-panel-body.tsx` 的
   * `taskMode` state（同一份事实源，不新建）。可选：旧轨道两屏没有任务模式概念，
   * 不传时「运行详情」页签就不显示这一行，而不是显示一个编造的默认值。
   */
  readonly taskMode?: boolean;
  /**
   * 2026-08-29 Claude Design 重设计稿——CK-P7 本会话编制从左栏搬进这里的「编制」
   * 页签（人类明确要求左栏拿掉「本线程的 AI 团队」卡片；同一份能力换个入口，
   * 不是撤掉。见 `copilotkit-v2-shell.tsx` 对应改动的头注）。整个 prop 可选：
   * `chat-read-screen.tsx`/`personal-chat-screen.tsx` 两条旧轨道各自仍在别处画
   * 自己的编制面板，不传这个 prop 时「编制」页签完全不渲染、不占页签栏一个位置
   * ——不是"渲染了一个空白页签"。
   */
  readonly roster?: RosterPanelProps;
}

const TAB_META: Record<InspectorTab, { label: string; Icon: typeof ListChecks }> = {
  progress: { label: "进度", Icon: ListChecks },
  materials: { label: "材料", Icon: FolderOpen },
  artifacts: { label: "产物", Icon: Package },
  roster: { label: "编制", Icon: Users },
  "run-details": { label: "运行详情", Icon: Settings2 },
};

export function ChatTaskInspector(props: ChatTaskInspectorProps): JSX.Element {
  const {
    hasSelection, threadId, artifacts, materials, loading,
    artifactsError, materialsError, onRetry, onOpenArtifact, pendingMaterialsCount,
    planTodos, isRunning, runPhaseLabel, runStartedAt, taskMode, roster,
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

  // issue #2260 —— 账本是唯一在 AG-UI 实时桥与 confirm/resume/retry 触发的
  // queued/tick 续跑两条通路下都跟得上真实进度的数据源（文件头注）。账本一旦
  // 有步骤（`ledger.steps.length > 0`），一律以它为准，不再信 `planTodos`：
  // 后者只在实时桥通路上更新，续跑通路下会停在陈旧值，正是本 issue 的症状。
  const { ledger: planLedger } = usePlanLedgerPolling(threadId);
  const ledgerTodos: readonly PlanTodo[] | null = planLedger !== null && planLedger.steps.length > 0
    ? planLedger.steps.map((s) => ({ content: s.content, status: s.status }))
    : null;
  const effectivePlanTodos = ledgerTodos ?? planTodos;

  const [activeTab, setActiveTab] = React.useState<InspectorTab>("progress");
  /**
   * 人类实测反馈（2026-08-30）—— 右栏展开后（有任务在跑/有产物材料），点头部
   * 「收起」按钮没有反应，要等任务结束、信号清空才会真的收起，看起来像"延迟"。
   *
   * 根因：这里原先只有一个 `manuallyExpanded` 布尔值，「收起」按钮只是把它
   * 设回 `false`——但折叠态是 `!manuallyExpanded && isInspectorCollapsed(...)`，
   * 只要 `isInspectorCollapsed` 因为还有信号（isRunning/有计划/有产物材料）
   * 判 `false`，收起按钮怎么点结果都是"仍然展开"，这不是延迟，是这颗按钮在
   * 有内容时**从不生效**，只在信号自然清空的那一刻顺带"看起来生效了"。
   *
   * 改法：把"用户手动展开过"这一个方向的标记，换成一个三态的显式覆盖——
   * `"expanded"` / `"collapsed"` / `null`（未覆盖，跟随 `isInspectorCollapsed`
   * 自动判定）。「收起」显式写入 `"collapsed"`，不再指望自动判据"恰好也判折叠"。
   *
   * ⚠ 覆盖不是一道永久锁：一旦有真正的新内容到达（`nextInspectorTab` 判定的
   * 跃迁——产物变多/材料变多/运行从停到跑），说明用户大概率想看这条新动态，
   * 这里清掉 `"collapsed"` 覆盖，交还给自动判据（此时新内容还在，自动判据会
   * 展开）。这与既有"手动展开过不再自动折叠回去"是同一条纪律的对称版本，见
   * `isInspectorCollapsed` 自己头注"折叠是没内容的默认值，不是一道锁"。
   */
  const [override, setOverride] = React.useState<"expanded" | "collapsed" | null>(null);

  const prevSignalsRef = React.useRef<InspectorSignals | null>(null);
  React.useEffect(() => {
    const prev = prevSignalsRef.current;
    prevSignalsRef.current = signals;
    setActiveTab((current) => {
      const next = nextInspectorTab(prev, signals, current);
      if (next !== current) {
        // 真正的新内容跃迁——收起覆盖不该继续压住它，让自动判据重新接管。
        setOverride((prevOverride) => (prevOverride === "collapsed" ? null : prevOverride));
      }
      return next;
    });
  }, [signals]);

  const hasPlan = effectivePlanTodos !== null && effectivePlanTodos.length > 0;
  const hasRunDetails = runPhaseLabel !== null || runElapsedSeconds !== null;
  const hasRoster = (roster?.roster?.agents.length ?? 0) > 0;
  const collapsed = override === "expanded"
    ? false
    : override === "collapsed"
      ? true
      : isInspectorCollapsed(signals, hasPlan, hasRunDetails, hasRoster);

  // roster 是可选能力：调用方没传（旧轨道两屏）就不占页签栏一个位置。
  const visibleTabs = INSPECTOR_TABS.filter((tab) => tab !== "roster" || roster !== undefined);
  React.useEffect(() => {
    if (activeTab === "roster" && roster === undefined) setActiveTab("progress");
  }, [activeTab, roster]);

  const selectTab = React.useCallback((tab: InspectorTab) => {
    setActiveTab(tab);
    setOverride("expanded");
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
          "flex shrink-0 items-center border-b border-border-subtle",
          collapsed ? "flex-col gap-1 py-2" : "flex-row justify-center gap-1 px-2 py-2.5",
        )}
      >
        {visibleTabs.map((tab) => {
          const { label, Icon } = TAB_META[tab];
          const selected = tab === activeTab && !collapsed;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              /*
                2026-09-03 人类反馈（真栈截图）「右边的 tabs 要简约，默认是 icon，
                选中的时候显示文字」—— 未选中页签只画图标（`aria-label`/`title` 兜住
                读屏与鼠标悬停），只有选中的那一个才展开出文字标签；折叠态本来就
                一直是纯图标，不受影响。文本从"始终可见"改成"只在选中时出现"，
                读屏必须另有名字，`aria-label` 常驻不受选中态影响。
              */
              aria-label={label}
              title={label}
              data-testid={`chat-task-workbench-inspector-tab-${tab}`}
              onClick={() => selectTab(tab)}
              className={cn(
                "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-11 transition-colors duration-fast",
                // 2026-09-03 人类反馈（真栈截图）「右边的 tab，样式不对」—— 原来是
                // `ring-2 ring-ring`（`--ring` 近黑，同 `--primary`），页签本身已经用
                // `bg-muted` 标出选中态，焦点环再叠一圈实心近黑矩形，在小尺寸页签上
                // 视觉上就是一个突兀的黑框。改成 `ring-inset` + 更细的 1px + 更低的
                // 不透明度（`ring-ring/40`）：焦点提示还在（键盘可见），只是不再是一块
                // 生硬的黑框，跟其余页签/按钮的克制视觉一致。
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40",
                collapsed || !selected ? "w-8 px-0" : "px-3",
                selected
                  ? "bg-muted font-medium text-card-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-card-foreground",
              )}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              {selected ? <span className="truncate">{label}</span> : null}
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
            onClick={() => setOverride("collapsed")}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40"
          >
            <PanelRightClose aria-hidden className="h-4 w-4" />
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
            onClick={() => setOverride("expanded")}
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
              planTodos={effectivePlanTodos}
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
              onOpen={onOpenArtifact}
            />
          ) : activeTab === "roster" && roster !== undefined ? (
            <RosterPanel {...roster} />
          ) : (
            <RunDetailsTab
              threadId={threadId}
              isRunning={isRunning}
              runPhaseLabel={runPhaseLabel}
              runElapsedSeconds={runElapsedSeconds}
              taskMode={taskMode}
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
 * ⚠ 本轮只放**当前真实拿得到**的几样：线程 id、当前阶段、已耗时、当前模式。
 * 模型 id、middleware 链、LangGraph 节点在 v2 的 AG-UI 事件流里**没有真实数据源**
 * （`lib/copilotkit-v2-run-progress.ts` 文件头已逐维核实过一次同样的边界），
 * 不为了把这一页填满而编造。
 *
 * PROP-CHAT-UIUX-ITER-002 V3 —— 新增「当前模式」行：读的是 composer 上真实的
 * `taskMode` state（透传自 `copilotkit-v2-panel-body.tsx`），不是新状态。
 * `taskMode === undefined`（调用方没传，旧轨道两屏没有任务模式概念）时不显示这
 * 一行，而不是显示一句编造的默认值——同本组件其余行"没有真实数据就不放"的纪律。
 */
function RunDetailsTab({
  threadId, isRunning, runPhaseLabel, runElapsedSeconds, taskMode,
}: {
  threadId: string | null;
  isRunning: boolean;
  runPhaseLabel: string | null;
  runElapsedSeconds: number | null;
  taskMode?: boolean;
}) {
  const rows: readonly (readonly [string, string])[] = [
    ["对话标识", threadId ?? "尚未创建"],
    ["运行状态", isRunning ? "运行中" : "空闲"],
    ["当前阶段", runPhaseLabel ?? "—"],
    ["本轮已用", runElapsedSeconds !== null ? `${runElapsedSeconds} 秒` : "—"],
    ...(taskMode === undefined
      ? []
      : [["当前模式", taskMode ? "任务模式（先计划后执行）" : "问答模式（直接回答）"] as const]),
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
