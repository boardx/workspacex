"use client";
import * as React from "react";
import { ListChecks, FolderOpen, Package, Settings2, Users, PanelRightClose, PanelRightOpen } from "lucide-react";
import { PanelResizeHandle } from "@/components/shell/panel-resize-handle";
import { PANEL_WIDTH_DEFAULT, readPanelWidth, writePanelWidth } from "@/lib/chat-workbench/panel-width";
import { cn } from "@/lib/utils";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatMaterialsPanel } from "@/components/chat/chat-materials-panel";
import { RosterPanel, type RosterPanelProps } from "@/components/chat/chat-roster-panel";
import {
  ChatMaterialsDropOverlay, useFileDropSurface, type ChatMaterialsUploadPort,
} from "@/components/chat/chat-composer-attachments";
import { AgentPlanPanel, type PlanTodo } from "@/components/chat/agent-plan-panel";
import {
  INSPECTOR_TABS,
  nextInspectorTab,
  type InspectorSignals,
  type InspectorTab,
} from "@/lib/chat-task-inspector-tabs";
import type { ListThreadArtifactsOut, ListThreadAttachmentsOut } from "@/lib/live-chat";
import { usePlanLedgerPolling } from "@/lib/use-plan-ledger-polling";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AgentArtifactVersionsPanel } from "@/components/chat/workbench/agent-artifact-versions-panel";
import { ChatArtifactView, type LoadedArtifact } from "@/components/chat/chat-artifact-view";
import { artifactFileName } from "@/lib/chat-workbench/artifact-download";
import {
  // `activeTab` 这个名字在本文件里已经是「右栏四个页签里选中的那一个」（InspectorTab）。
  // 同名会静默遮蔽——tsc 正是在这里报的 TS2349，重命名而不是让两个概念共用一个词。
  EMPTY_ARTIFACT_TABS, activateTab, activeTab as activeArtifactTab, closeTab, openTab,
  type ArtifactTab, type ArtifactTabState,
} from "@/lib/chat-workbench/artifact-tabs";
import { ArrowLeft, Check, Copy, CornerUpLeft, Download, Maximize2, X } from "lucide-react";
import { scrollToAnchor } from "@/lib/chat-workbench/scroll-to-anchor";

const mobileQuery = "(max-width: 767px)";
/** 持久化用的面板 id。每条侧栏一把 key，右栏与将来的左栏不共用一个宽度。 */
const INSPECTOR_PANEL_ID = "chat-inspector";
function subscribeViewport(notify: () => void): () => void {
  const query = window.matchMedia?.(mobileQuery);
  query?.addEventListener("change", notify);
  return () => query?.removeEventListener("change", notify);
}
function mobileSnapshot(): boolean {
  return window.matchMedia?.(mobileQuery).matches ?? false;
}
function desktopSnapshot(): boolean { return false; }

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
  readonly projectId?: string | null;
  readonly canEditArtifacts?: boolean;
  readonly onRunStarted?: (runId: string) => void;
  readonly artifacts: ListThreadArtifactsOut | null;
  readonly materials: ListThreadAttachmentsOut | null;
  readonly loading: boolean;
  readonly artifactsError: string | null;
  readonly materialsError: string | null;
  readonly onRetry: () => void;
  /** issue #2099 —— 产物条目点击回调；不传时「产物」页签的条目诚实退回不可点
   *  （见 `ChatArtifactsPanel` 自己的 `onOpen` 可选约定），不是这里另造一条规则。 */
  readonly onOpenArtifact?: (item: ListThreadArtifactsOut["items"][number]) => void;
  /** 取产物源用的会话令牌。不传时 `ChatArtifactView` 退回同源 cookie 那条路径。 */
  readonly bearer?: string;
  /** 已上传但还没随消息发出的材料条数（composer 附件区），与已落库材料一起算「材料」。 */
  readonly pendingMaterialsCount: number;
  /**
   * issue #3347 —— 「材料」页签的上传入口（点击 + 拖拽）。
   *
   * 这是 composer 那**同一个** `useChatAttachments` 控制器的最小能力面，由
   * `CopilotKitV2Panel` 经外壳桥上来（见 `copilotkit-v2-shell.tsx` 的
   * `attachUploadPort`）。`null` = 当前没有可用的上传通道（未登录 / 还没线程），
   * 此时不渲染入口——渲染一个点了必炸的按钮比不渲染更坏（既有纪律，见
   * `ChatMaterialsPanel` 头注）。
   *
   * ⚠ 不在这里新建第二个控制器：那会造出第二条 pending 队列，它的 `attachmentIds`
   * 永远不会被 composer 的发送路径读到 ⇒ 「上传成功但消息发出去时文件没跟着走」
   * ——正是 #3346 那条 P0 的形状。
   */
  readonly attachUploadPort?: ChatMaterialsUploadPort | null;
  /** issue #3347 —— 只读 / 归档时的禁用理由；非 `null` 时上传入口禁用并写出理由。 */
  readonly uploadDisabledReason?: string | null;
  /** `STATE_SNAPSHOT` 解析出的计划快照；null = 本轮还没有计划。 */
  readonly planTodos: readonly PlanTodo[] | null;
  readonly isRunning: boolean;
  /** 当前阶段文案（`copilotkit-v2-run-progress.ts`），无可翻译事件时为 null。 */
  readonly runPhaseLabel: string | null;
  readonly recoveryDiagnostic?: string | null;
  /** `RUN_STARTED` 时刻（epoch ms）；秒数在本组件内派生——见 panel 侧同名 prop 的注释：
   *  每秒变一次的值不上抛，重渲染只落在这棵子树上。 */
  readonly runStartedAt: number | null;
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
  const mobile = React.useSyncExternalStore(subscribeViewport, mobileSnapshot, desktopSnapshot);
  const {
    hasSelection, threadId, artifacts, materials, loading,
    artifactsError, materialsError, onRetry, onOpenArtifact, pendingMaterialsCount,
    planTodos, isRunning, runPhaseLabel, runStartedAt, roster,
    attachUploadPort = null, uploadDisabledReason = null,
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
  const { ledger: planLedger } = usePlanLedgerPolling(threadId, props.projectId);
  const ledgerTodos: readonly PlanTodo[] | null = planLedger !== null && planLedger.steps.length > 0
    ? planLedger.steps.map((s) => ({ content: s.content, status: s.status }))
    : null;
  const effectivePlanTodos = ledgerTodos ?? planTodos;

  const [activeTab, setActiveTab] = React.useState<InspectorTab>("progress");
  /**
   * 2026-09-23 人类交办「对标 Claude Code / Codex，应该在右边可以打开结果」——
   * 右栏里被打开的那一个产物。非 null = 产物页签进入**详情态**（列表 ↔ 详情，
   * 带返回），此前唯一的打开方式是模态对话框，模态挡住对话就没法边看边追问。
   *
   * ⚠ 按 threadId 清空：换线程后旧线程的产物 id 在新线程上取不到源，会渲染成
   * 一条 NOT_VISIBLE，看起来像「这个产物坏了」而不是「你换线程了」。
   */
  const [artifactTabs, setArtifactTabs] = React.useState<ArtifactTabState>(EMPTY_ARTIFACT_TABS);
  React.useEffect(() => { setArtifactTabs(EMPTY_ARTIFACT_TABS); setArtifactListMode(true); }, [threadId]);
  /**
   * 「回到列表」与「开着哪几份」是**两件事**，不能用一个状态表示。
   *
   * 第一版让「返回」直接把开着的几份全清掉——于是「看完 A，回列表点开 B」之后
   * A 就没了，页签条永远只有一份，这个功能等于不存在（两条测试当场红）。
   * 返回只是把列表铺回来，开着的那几份仍然开着，随时能切回去。
   */
  const [artifactListMode, setArtifactListMode] = React.useState(true);
  /*
   * ⚠ 这里**故意没有**「关掉最后一份 ⇒ 回到列表」那条 effect。
   *
   * 我先写了它，然后发现它守的状态从界面上到不了：页签条只在开着 ≥2 份时才画，
   * 只剩一份时没有关闭按钮，所以「把份数关到 0」在 UI 上不存在（写它的那条测试
   * 当场红在「找不到关闭按钮」上）。份数为 0 只在换线程时出现，而换线程那条
   * effect 已经把列表态一起设回去了。
   *
   * 留着它就是一段永远不执行的分支加一条永远绿的测试——[[red-does-not-mean-it-ran]]
   * 的同一形状。要么让它可达，要么不写；这里选不写。
   */
  const openInPanel = artifactListMode ? null : activeArtifactTab(artifactTabs);
  const openArtifactInPanel = React.useCallback(
    (item: ArtifactTab) => {
      setArtifactTabs((prev) => openTab(prev, item));
      setArtifactListMode(false);
    },
    [],
  );
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
   * `"expanded"` / `"collapsed"` / `null`（未覆盖）。「收起」显式写入
   * `"collapsed"`，不再指望自动判据"恰好也判折叠"。
   *
   * ⚠ issue #2695（2026-09-04 人类原话「应改为仅手动点击才展开」，覆盖上面
   * 2026-08-30 那版"新内容到达就清掉收起覆盖"的对称设计）—— 那版设计的本意
   * 是好的（不让用户错过新动态），但实测效果是：只要有新素材/产物/运行信号
   * 到达，无论用户是否点过「收起」，面板都会自己弹开，用户体验成了"关不掉的
   * 面板"。人类的结论很直接：**折叠只能靠自动判据探测"有没有内容"，展开只能
   * 靠用户手点**——不再有"新内容到达 = 视同用户想展开"这一条自动路径。
   * 所以这里不再监听信号跃迁去清 `"collapsed"` 覆盖；`nextInspectorTab` 仍然
   * 正常跑，只是切**未必可见的** `activeTab`，供用户之后手动展开时落在最新
   * 页签上，本身不触发展开。
   */
  const [override, setOverride] = React.useState<"expanded" | "collapsed" | null>(null);

  const prevSignalsRef = React.useRef<InspectorSignals | null>(null);
  React.useEffect(() => {
    const prev = prevSignalsRef.current;
    prevSignalsRef.current = signals;
    setActiveTab((current) => nextInspectorTab(prev, signals, current));
  }, [signals]);

  /**
   * issue #2695 —— 折叠态只有"用户手点展开/收起"（`override`）与"默认折叠"
   * 两条路径，不再有 `isInspectorCollapsed` 驱动的自动展开默认路径：`override`
   * 为 `null`（用户从没手动操作过）时一律折叠,即便此刻已经有素材/产物/在跑的
   * run——那也只是把「进度/产物/材料」标出来等用户自己点开看,不是替用户点开。
   * `isInspectorCollapsed` 本体仍在 `chat-task-inspector-tabs.ts` 里保留、被
   * 单测钉住,是给未来"折叠时页签角标要不要标红点"一类需求留的信号,不在这里
   * 驱动展开态。
   */
  const collapsed = override !== "expanded";

  // roster 是可选能力：调用方没传（旧轨道两屏）就不占页签栏一个位置。
  const visibleTabs = INSPECTOR_TABS.filter((tab) => tab !== "roster" || roster !== undefined);
  React.useEffect(() => {
    if (activeTab === "roster" && roster === undefined) setActiveTab("progress");
  }, [activeTab, roster]);

  const selectTab = React.useCallback((tab: InspectorTab) => {
    setActiveTab(tab);
    setOverride("expanded");
  }, []);

  /**
   * issue #3347 —— 整条右栏都是落区，不只是「材料」页签的那块内容区。
   *
   * 理由有两条，都不是审美：
   *  ① 用户拖到右栏时未必正停在「材料」页签上（默认页签是「进度」）。只在材料页签
   *     内容区接 drop，等于"看着像能拖、松手没反应"。落在任意页签都收下，并自动切
   *     到「材料」页签把结果亮出来。
   *  ② 不接的话浏览器**默认会打开那个文件**，把用户从这条对话里导航走。见
   *     `useFileDropSurface` 的 onDrop 注释。
   *
   * `enabled` 为假（没有上传通道 / 只读 / 归档）时，handlers 仍然挂着但全部早退——
   * 于是 drop 的 `preventDefault` 也不发生……那会退回浏览器打开文件。所以只读态**也**
   * 要接住：`onFiles` 走"说明为什么不能上传"的分支，不是静默丢弃。
   */
  const canUpload = attachUploadPort !== null && uploadDisabledReason === null;
  const [uploadNotice, setUploadNotice] = React.useState<string | null>(null);
  const showMaterials = React.useCallback((notice: string | null) => {
    setUploadNotice(notice);
    selectTab("materials"); // 复用既有的"切页签并展开"，不在这里重写一遍
  }, [selectTab]);
  // 换线程 = 换一段对话，上一段的落区说明不该跟过来（同 `useChatAttachments` 切线程清空）。
  React.useEffect(() => { setUploadNotice(null); }, [threadId]);
  const { dragActive, dragHandlers } = useFileDropSurface({
    enabled: attachUploadPort !== null,
    onFiles: (files) => {
      if (!canUpload) { showMaterials(uploadDisabledReason ?? "当前无法上传。"); return; }
      showMaterials(null);
      attachUploadPort.pickFiles(files);
    },
    onNonFile: () => showMaterials(
      "只支持拖入文件。拖进来的是文字、链接或文件夹（浏览器不把文件夹当文件交给网页），没有上传任何东西。",
    ),
  });
  /** 拖拽高亮只在真的能接的时候亮——只读态亮一个"松开即上传"是骗人。 */
  const dropActive = dragActive && canUpload;

  /*
   * 2026-09-23 人类要求：「可以拖拽边界」。此前整个壳里一处拖拽都没有——右栏只有
   * `w-72`（288px）/ `w-10` 两档写死。现在展开态的宽度由状态给，并持久化到 localStorage：
   * 用户调过的宽度是他的工作习惯，不是服务端事实，同 `shell.leftCollapsed` 的既有先例。
   *
   * ⚠ 初值**不在 useState 里读 localStorage**：SSR 没有 storage，首帧两端必须一致，
   *   否则 hydration 警告（同 `app-shell.tsx` 折叠态的做法，把读取放进 effect）。
   *   折叠态与移动态照旧用类名，宽度只作用于「桌面 + 展开」这一档。
   */
  const [width, setWidth] = React.useState(PANEL_WIDTH_DEFAULT);
  React.useEffect(() => {
    setWidth(readPanelWidth(INSPECTOR_PANEL_ID, typeof window === "undefined" ? null : window.localStorage, window.innerWidth));
  }, []);
  const applyWidth = React.useCallback((next: number) => {
    setWidth(next);
    writePanelWidth(INSPECTOR_PANEL_ID, next, typeof window === "undefined" ? null : window.localStorage);
  }, []);
  const sizable = !mobile && !collapsed;

  const inspector = (
    <aside
      {...dragHandlers}
      style={sizable ? { width: `${String(width)}px` } : undefined}
      className={cn(
        "relative flex shrink-0 flex-col border-l border-border bg-card",
        mobile ? "min-h-0 flex-1 w-full border-l-0" : collapsed ? "w-10" : undefined,
      )}
      data-testid="chat-task-workbench-inspector"
      data-collapsed={collapsed ? "true" : "false"}
      data-active-tab={activeTab}
      data-drop-active={dropActive ? "true" : "false"}
      aria-label="任务检查器"
    >
      {/* 遮罩是 `pointer-events-none` 的纯视觉层，drag 事件继续落在挂了 handlers 的
          这个 `aside` 上（同 `ChatFullSurfaceDropOverlay` 的做法）。`relative` 在
          className 里，遮罩才有定位参照。 */}
      {/* 把手贴在右栏的**左**边界上：往左拖变宽。折叠态（40px 图标条）与移动态不给把手——
          那两档不是「更窄的同一档」，是另一种形态。 */}
      {sizable && (
        <PanelResizeHandle
          edge="left"
          width={width}
          onWidthChange={applyWidth}
          label="调整任务检查器宽度"
          testId="chat-task-workbench-inspector-resize"
        />
      )}
      <ChatMaterialsDropOverlay active={dropActive} />
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
              uploadCtl={attachUploadPort}
              uploadNotice={uploadNotice}
              readOnlyReason={uploadDisabledReason}
              pendingCount={pendingMaterialsCount}
              dropActive={dropActive}
            />
          ) : activeTab === "artifacts" ? (
            <>
            {openInPanel && threadId ? (
              <ArtifactDetail
                tabs={artifactTabs}
                onActivate={(id) => { setArtifactTabs((prev) => activateTab(prev, id)); }}
                onClose={(id) => { setArtifactTabs((prev) => closeTab(prev, id)); }}
                threadId={threadId}
                projectId={props.projectId ?? null}
                bearer={props.bearer}
                item={openInPanel}
                onBack={() => { setArtifactListMode(true); }}
                onEnlarge={onOpenArtifact ? () => onOpenArtifact(openInPanel) : undefined}
              />
            ) : (
            <>
            {threadId && <AgentArtifactVersionsPanel
              key={threadId}
              threadId={threadId}
              projectId={props.projectId}
              canEdit={props.canEditArtifacts ?? false}
              refreshKey={`${isRunning}:${artifactsCount}`}
              onRunStarted={props.onRunStarted}
            />}
            <ChatArtifactsPanel
              hasSelection={hasSelection}
              artifacts={artifacts}
              loading={loading}
              error={artifactsError}
              onRetry={onRetry}
              onOpen={threadId ? openArtifactInPanel : onOpenArtifact}
            />
            </>
            )}
            </>
          ) : activeTab === "roster" && roster !== undefined ? (
            <RosterPanel {...roster} />
          ) : (
            <RunDetailsTab
              threadId={threadId}
              isRunning={isRunning}
              runPhaseLabel={runPhaseLabel}
              runElapsedSeconds={runElapsedSeconds}
              recoveryDiagnostic={props.recoveryDiagnostic}
            />
          )}
        </div>
      )}
    </aside>
  );
  if (!mobile) return inspector;
  return (
    <Dialog open={!collapsed} onOpenChange={(open) => setOverride(open ? "expanded" : "collapsed")}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="chat-task-workbench-mobile-open"
          aria-label="打开任务进度与成果"
          className="flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-container text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PanelRightOpen aria-hidden className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="left-auto right-0 top-0 h-dvh max-h-dvh w-[min(92vw,24rem)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none p-0"
      >
        <DialogTitle className="sr-only">任务进度与成果</DialogTitle>
        {inspector}
      </DialogContent>
    </Dialog>
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
 * ⚠ 本轮只放**当前真实拿得到**的几样：线程 id、当前阶段、已耗时。
 * 模型 id、middleware 链、LangGraph 节点在 v2 的 AG-UI 事件流里**没有真实数据源**
 * （`lib/copilotkit-v2-run-progress.ts` 文件头已逐维核实过一次同样的边界），
 * 不为了把这一页填满而编造。
 *
 * issue #2770 —— 此前还有一行「当前模式」（PROP-CHAT-UIUX-ITER-002 V3），读的是
 * composer「任务模式」开关的 state；该开关已删（要不要先计划由内核自动判，见
 * `copilotkit-v2-panel-body.tsx` 同 issue 头注），这一行随之删除，不改成一句编造的
 * 固定文案——同本组件其余行"没有真实数据就不放"的纪律。
 */
function RunDetailsTab({
  threadId, isRunning, runPhaseLabel, runElapsedSeconds, recoveryDiagnostic,
}: {
  threadId: string | null;
  isRunning: boolean;
  runPhaseLabel: string | null;
  runElapsedSeconds: number | null;
  recoveryDiagnostic?: string | null;
}) {
  const rows: readonly (readonly [string, string])[] = [
    ["对话标识", threadId ?? "尚未创建"],
    ["运行状态", isRunning ? "运行中" : "空闲"],
    ["当前阶段", runPhaseLabel ?? "—"],
    ["本轮已用", runElapsedSeconds !== null ? `${runElapsedSeconds} 秒` : "—"],
    ...(recoveryDiagnostic ? [["恢复状态", recoveryDiagnostic] as const] : []),
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

/**
 * 右栏里的产物详情态。
 *
 * 这一档与模态的分工（2026-09-23）：**默认在右栏**（不挡对话，可以边看结果边追问，
 * 边界可拖），需要更大幅面时点「放大」才升到模态。两处渲染同一个 `ChatArtifactView`，
 * 不是两套展示逻辑——同一事实不得声明在两处。
 *
 * `onEnlarge` 可选：宿主没给模态入口时（如 `onOpenArtifact` 未传）不画这颗按钮，
 * 而不是画一颗点了没反应的——同 `ChatArtifactsPanel` 的 `onOpen` 可选约定（#2099）。
 */
function ArtifactDetail({
  threadId, projectId, bearer, item, onBack, onEnlarge, tabs, onActivate, onClose,
}: {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly bearer: string | undefined;
  readonly item: ListThreadArtifactsOut["items"][number];
  readonly onBack: () => void;
  readonly onEnlarge?: () => void;
  readonly tabs: ArtifactTabState;
  readonly onActivate: (artifactId: string) => void;
  readonly onClose: (artifactId: string) => void;
}): React.JSX.Element {
  /**
   * 载入到的那一份。动作条按它开关：**没载到就不给按**——一颗点了没反应的
   * 「复制」比没有这颗按钮更糟（#2099 同一条纪律）。
   */
  const [doc, setDoc] = React.useState<LoadedArtifact | null>(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => { setCopied(false); }, 1600);
    return () => { clearTimeout(timer); };
  }, [copied]);

  const copy = (): void => {
    if (doc === null) return;
    void navigator.clipboard?.writeText(doc.markdown).then(() => { setCopied(true); });
  };
  const download = (): void => {
    if (doc === null) return;
    // 下载的是**已经载到的这一份**，不重新取源：否则会出现「看到的是 v3、
    // 存下来的是 v4」这种同一动作里两处不一致。
    const url = URL.createObjectURL(new Blob([doc.markdown], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = artifactFileName(item.title);
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionClass =
    "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-inspector-artifact-detail">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={onBack}
          data-testid="chat-inspector-artifact-back"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-12 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          产物
        </button>
        <span className="min-w-0 flex-1 truncate text-12 font-medium text-foreground" title={item.title}>
          {item.title}
        </span>
        <button
          type="button" onClick={copy} disabled={doc === null}
          data-testid="chat-inspector-artifact-copy"
          aria-label={copied ? "已复制" : "复制全文"} title={copied ? "已复制" : "复制全文"}
          className={actionClass}
        >
          {copied
            ? <Check className="size-3.5 text-success" aria-hidden />
            : <Copy className="size-3.5" aria-hidden />}
        </button>
        <button
          type="button" onClick={download} disabled={doc === null}
          data-testid="chat-inspector-artifact-download"
          aria-label="下载" title="下载" className={actionClass}
        >
          <Download className="size-3.5" aria-hidden />
        </button>
        {onEnlarge ? (
          <button
            type="button"
            onClick={onEnlarge}
            data-testid="chat-inspector-artifact-enlarge"
            aria-label="放大查看"
            title="放大查看"
            className={actionClass}
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {/* 同时开着好几份时才画页签条：只开着一份时它是一条重复了上面标题的空行。
          R2 之后「看完 A 再看 B」要返回列表、在列表里重新找 B——来回切两三次就是
          六到八次点击。开着的几份之间切换应该是一次点击。判据（满了淘汰谁、关掉
          当前这份落到哪）在 lib/chat-workbench/artifact-tabs.ts，不写成内联三元。 */}
      {tabs.tabs.length > 1 ? (
        <div
          role="tablist" aria-label="已打开的结果"
          data-testid="chat-inspector-artifact-tabs"
          className="flex min-w-0 gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1"
        >
          {tabs.tabs.map((tab) => {
            const current = tab.artifactId === item.artifactId;
            return (
              <span
                key={tab.artifactId}
                className={cn(
                  "group inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-11",
                  current ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                <button
                  type="button" role="tab" aria-selected={current}
                  data-testid="chat-inspector-artifact-tab"
                  onClick={() => { onActivate(tab.artifactId); }}
                  className="min-w-0 truncate focus-visible:outline-none"
                  title={tab.title}
                >{tab.title}</button>
                <button
                  type="button"
                  data-testid="chat-inspector-artifact-tab-close"
                  aria-label={`关闭 ${tab.title}`}
                  onClick={() => { onClose(tab.artifactId); }}
                  className="shrink-0 rounded text-muted-foreground hover:text-foreground"
                ><X className="size-3" aria-hidden /></button>
              </span>
            );
          })}
        </div>
      ) : null}
      <ArtifactSourceLine item={item} />
      <ChatArtifactView
        /*
         * 窄栏守卫：右栏可以被拖到 240px，代码块与表格在那个宽度下会横向溢出，
         * 把整条右栏撑出横向滚动条（连标题栏一起歪掉）。给它们各自的横向滚动，
         * 正文本身仍然在栏宽内重排。
         */
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-13 [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto"
        key={item.artifactId}
        threadId={threadId}
        projectId={projectId}
        artifactId={item.artifactId}
        bearer={bearer}
        onLoaded={setDoc}
      />
    </div>
  );
}

/**
 * 这一份产物**自己的出处** —— TW-P1-4 的「来源」锚点。
 *
 * ## 它替换了什么（2026-09-23，R7 留下的那条缺口）
 *
 * `-sources` 原先挂在产物**列表的包裹 div** 上：列表在就算「来源齐」，哪怕每一条都
 * 写着「未挂出处」。R7 修掉了同类的「预览」「版本」两颗，这颗当时没修——搬到逐条
 * 出处行上会让同名锚点出现 N 次，而 Playwright 的 `getByTestId` 是 strict 的。
 *
 * 详情态一次只显示一份产物，所以锚点在这里天然唯一，而且它陈述的是**这一份**的出处：
 *   · `hasSource` 逐产物不同（列表标题那种静态文字做不到这一点，所以它不可证伪）；
 *   · `messageId` 是 `listThreadArtifacts` 契约里就有的回链（与 `provenanceBacklink
 *     .messageId` 同一事实的两个读投影），可以真的跳回那条消息。
 *
 * ⚠ 仍然**没有**逐条引用清单（citations 在服务端 `findCitationsForMessage` 里，
 * 但没有按产物读回的接口）。所以这条线说的是「有没有挂出处 + 出处在哪条消息」，
 * 不是「出处有哪些」。不在文案上暗示后者。
 */
function ArtifactSourceLine({ item }: { readonly item: ArtifactTab }): React.JSX.Element {
  const [missing, setMissing] = React.useState(false);
  const messageId: unknown = (item as { messageId?: unknown }).messageId;
  const canJump = typeof messageId === "string" && messageId !== "";

  return (
    <p
      data-testid="chat-task-workbench-artifact-sources"
      className="flex items-center gap-2 border-b border-border-subtle px-3 py-1 text-10 text-muted-foreground"
    >
      <span>{item.hasSource ? "已挂出处" : "未挂出处"}</span>
      {canJump ? (
        <button
          type="button"
          data-testid="chat-inspector-artifact-source-jump"
          onClick={() => { setMissing(!scrollToAnchor("data-message-id", messageId)); }}
          className="inline-flex items-center gap-0.5 rounded px-1 text-primary hover:bg-accent"
        >
          <CornerUpLeft className="size-3" aria-hidden />
          跳到原消息
        </button>
      ) : null}
      {/* 找不到就说出来。静默失败会让用户以为这颗按钮坏了——原消息可能只是还没加载
          进当前这一页（对话列表是分页的），那是两件不同的事。 */}
      {missing ? <span data-testid="chat-inspector-artifact-source-missing">原消息不在当前视图里</span> : null}
    </p>
  );
}
