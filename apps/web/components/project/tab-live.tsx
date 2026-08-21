"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle, StatChip } from "./parts";
import { ROLE_STAGE_CONTROL, observerHidden, type ProjectRole } from "@/lib/mock/project";
import { ApiError } from "@/lib/api-client";
import {
  advanceAgendaSegment,
  AGENDA_SEGMENT_STATE_LABEL,
  type ListAgendaSegmentsOut,
} from "@/lib/live-projects";
import { GROUP_STATUS_LABEL, type Group, type ProjectGroupingOut } from "@/lib/live-project-prep";
import { useOptionalSession } from "@/components/session/session-provider";
import type { ViewerOptionsOut } from "@/lib/live-collab-viewer-role";

/**
 * 现场协作主持台（F963，2026-08-19；F01/2026-08-20 加视角切换器）。
 *
 * ⚠ **状态条接真、四组并行整块降级为如实空态**，同 F172 对 `tab-overview.tsx`
 *   「当前环节」卡与「待办」块的处置纪律（`getProjectOverview` 只给 `{title, state}`
 *   没有剩余时长 ⇒ 删倒计时；待办无契约来源 ⇒ 整块改如实说明，不渲染编造文案）——
 *   本次同理：`listAgendaSegments`/`advanceAgendaSegment` 已签核且真实可用，环节
 *   标题/序号/状态/推进动作接真；但「四组并行」卡片的引述/画布进度/素材充足度/
 *   现场介入标记在 project 束契约里**完全无来源**（`quote`/`canvas` 归 canvas/recording
 *   束、`fill`/`needs` 全仓零来源，2026-08-19 人类会话已确认范围），继续渲染
 *   `LIVE_GROUPS` 那组 mock 数字会与真实状态条同屏并列、用户分不清真假——同 F172
 *   点名的「主要缺陷」是同一种问题，故整块降级为如实空态，不是新造一种处置。
 *
 * ⚠ **F01 视角切换器（phase-10 viewer-role 束，design-signoff.md 已签核 2026-08-20）**：
 *   `主持台·全场 / 分组` 二档切换 + 角色锁定。数据源全部真实，无一处编造：
 *   - 分组选项来自 `getProjectGrouping`（已 passing，`Group[]`），facilitator 可见全部；
 *     groupLead/member 只能看自己所在的一组（本组名从 `useOptionalSession().identity.groupName`
 *     取——真实会话身份，不是 mock；取不到时如实显示「看不出你在哪一组」，不猜一个默认组）；
 *     observer 只有「主持台·全场」一个选项（OPEN-QUESTIONS.md Q1 已裁决：全场只读聚合，
 *     不含任何一组的原始转写/对话逐字稿——本 feature 只做到「不渲染分组选项」这一层，
 *     真正的服务端拒绝面属 F02）。
 *   - 分组状态后缀用 `Group.status`（`GROUP_STATUS_LABEL`，契约已有的三态：录音就绪/缺人/
 *     需介入）——这是**已签核契约里的真实字段**，不是 00-overview.md 硬前置里说的那个
 *     「全仓无来源」的现场态『需介入』（那个是环节状态条右上角的告警 pill，仍然是 ＊ 占位，
 *     两者字面同名但不是同一件事，不要混为一谈）。
 *   - 选中某个分组时展示该组的真实字段（名称/场景/状态/组长与组员计数）；
 *     不展示 canvas/recording 归属的实时引述与画布进度（那些字段依旧全仓无来源，
 *     沿用「四组并行」块已有的诚实空态纪律，本 feature 未新造编造数据）。
 *   - 「缺N人」（到场人数）与「需介入」（现场告警）两个状态后缀不在本 feature 范围内
 *     （分别依赖 F05 分组签到、以及全仓无来源的现场介入判据），维持 ＊ 占位，
 *     见 `viewer-role/design-signoff.md` frontmatter `scope_note`。
 *
 * ⚠ **F02 服务端强制面（phase-10 viewer-role 束，2026-08-21）**：视角选项与顶部提示条
 *   文案现在优先取 `viewerOptions`（新端点 `getViewerOptions`，服务端按角色 + 所在组
 *   算好、不是前端二次过滤的权威结果——`domain.md` 不变量 1）；请求还没回来或失败时
 *   回退到本地 `computeViewerOptions`（同 F01 既有行为，纯展示层兜底，不是安全边界）。
 *   `promptText` 是服务端给的角色区分文案（见 `get-viewer-options.ts` 的
 *   `promptTextForRole`），不是前端字典硬编码。
 */
export function TabLive({
  view,
  readOnly = false,
  liveSegments = null,
  liveSegmentsLoading = false,
  liveSegmentsError = null,
  liveGrouping = null,
  liveGroupingLoading = false,
  liveGroupingError = null,
  viewerOptions = null,
  onAdvanced,
}: {
  view: ProjectRole;
  readOnly?: boolean;
  liveSegments?: ListAgendaSegmentsOut | null;
  liveSegmentsLoading?: boolean;
  liveSegmentsError?: string | null;
  liveGrouping?: ProjectGroupingOut | null;
  liveGroupingLoading?: boolean;
  liveGroupingError?: string | null;
  /** F02：服务端权威的视角列表 + 提示条文案；`null` = 还没拿到（本地兜底）。 */
  viewerOptions?: ViewerOptionsOut | null;
  onAdvanced?: () => void;
}) {
  const stageControl = ROLE_STAGE_CONTROL[view] && !readOnly;
  const isObserver = observerHidden(view);
  const myGroupName = useOptionalSession()?.identity?.groupName ?? null;

  const groups = liveGrouping?.groups ?? [];
  const fallback = computeViewerOptions(view, groups, myGroupName);
  const { options, locked, defaultId } = viewerOptions !== null
    ? {
        options: viewerOptions.viewers as ViewerOption[],
        locked: view !== "facilitator",
        defaultId: viewerOptions.viewers[0]?.id ?? null,
      }
    : fallback;
  const [selectedId, setSelectedId] = React.useState<string>(defaultId ?? "stage");
  // 分组数据是异步拉回来的：首次渲染时 options 可能还是空的，等真正到手后把选中项
  // 同步成默认值，不然 groupLead/member 会先看见「找不到分组」的空态再跳成真内容。
  React.useEffect(() => {
    if (defaultId !== null) setSelectedId(defaultId);
  }, [defaultId]);
  const selected = options.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" data-testid="project-live">
      {viewerOptions !== null && (
        <p className="text-11 text-muted-foreground" data-testid="lc-viewer-role-prompt">
          {viewerOptions.promptText}
        </p>
      )}

      <StageBar
        segments={liveSegments}
        loading={liveSegmentsLoading}
        error={liveSegmentsError}
        stageControl={stageControl}
        onAdvanced={onAdvanced}
      />

      <ViewerSwitcher
        options={options}
        locked={locked}
        loading={liveGroupingLoading}
        error={liveGroupingError}
        selectedId={selectedId}
        onSelect={setSelectedId}
        unresolved={!liveGroupingLoading && !liveGroupingError && options.length === 0}
      />

      {selected?.kind === "group" ? (
        <GroupPanel group={selected.group} />
      ) : (
        <>
          <SectionTitle meta={isObserver ? "只读" : "画布/转写接线未完成，暂不可用"}>
            四组并行
          </SectionTitle>
          <Card>
            <p className="px-3.5 py-3 text-11 leading-relaxed text-muted-foreground" data-testid="project-live-groups-unavailable">
              每组的实时引述、画布完成度、素材充足度、现场介入标记在项目域契约里还没有出处——
              引述与画布归 canvas/recording 束，素材充足度与介入标记全仓目前没有任何字段能表达
              （2026-08-19 已确认范围）。它们要真，得先补上对应契约与仓储，那是接下来的 feature，
              本版不显示编造数字。
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

/** 视角选项：「主持台·全场」或某一个真实分组。 */
type ViewerOption =
  | { id: "stage"; kind: "stage"; label: string }
  | { id: string; kind: "group"; label: string; group: Group };

/**
 * 按角色计算视角切换器的选项集合（纯函数，可单测）。
 *
 * - facilitator：全场 + 全部真实分组，可切换。
 * - groupLead / member：锁定本组（按 `myGroupName` 在真实分组列表里找同名的那一组）；
 *   找不到（`identity.groupName` 为空或与任何分组都对不上）时返回空 options，
 *   由调用方渲染诚实的「看不出你在哪一组」，**不猜一个默认组**。
 * - observer：锁定「主持台·全场」（Q1 裁决），不渲染任何分组选项。
 */
export function computeViewerOptions(
  role: ProjectRole,
  groups: readonly Group[],
  myGroupName: string | null,
): { options: ViewerOption[]; locked: boolean; defaultId: string | null } {
  const stageOption: ViewerOption = { id: "stage", kind: "stage", label: "主持台·全场" };
  const groupOptions: ViewerOption[] = groups.map((g) => ({ id: g.groupId, kind: "group", label: g.name, group: g }));

  if (role === "facilitator") {
    return { options: [stageOption, ...groupOptions], locked: false, defaultId: "stage" };
  }
  if (role === "observer") {
    return { options: [stageOption], locked: true, defaultId: "stage" };
  }
  // groupLead / member：只锁定真实存在、名字对得上的那一组。
  const mine = myGroupName !== null ? groups.find((g) => g.name === myGroupName) ?? null : null;
  if (mine === null) return { options: [], locked: true, defaultId: null };
  return { options: [{ id: mine.groupId, kind: "group", label: mine.name, group: mine }], locked: true, defaultId: mine.groupId };
}

function ViewerSwitcher({
  options,
  locked,
  loading,
  error,
  selectedId,
  onSelect,
  unresolved,
}: {
  options: ViewerOption[];
  locked: boolean;
  loading: boolean;
  error: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
  unresolved: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.id === selectedId) ?? null;

  return (
    <div data-testid="lc-viewer-switcher" className="relative">
      <div className="flex items-center gap-2">
        <span className="text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {loading && <span className="text-11 text-muted-foreground" data-testid="lc-viewer-loading">读取分组中…</span>}
        {!loading && error && (
          <span className="text-11 text-destructive" data-testid="lc-viewer-error">分组读取失败：{error}</span>
        )}
        {!loading && !error && unresolved && (
          <span className="text-11 text-destructive" data-testid="lc-viewer-unresolved">看不出你在哪一组</span>
        )}
        {!loading && !error && !unresolved && (
          <Button
            size="xs"
            variant="outline"
            disabled={locked || options.length <= 1}
            data-testid="lc-viewer-trigger"
            className="gap-1"
            onClick={() => setOpen((v) => !v)}
          >
            {current?.label ?? "主持台·全场"}
            {!locked && options.length > 1 && <ChevronDown className="h-3 w-3" aria-hidden />}
          </Button>
        )}
      </div>
      {open && !locked && options.length > 1 && (
        <div
          data-testid="lc-viewer-menu"
          className="absolute left-0 top-full z-10 mt-1 flex min-w-48 flex-col rounded-md border bg-popover py-1 shadow-md"
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid={`lc-viewer-option-${o.id}`}
              className="flex items-center justify-between px-3 py-1.5 text-left text-12 transition-colors hover:bg-accent"
              onClick={() => {
                onSelect(o.id);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.kind === "group" && o.group.status !== "recording-ready" && (
                <span className="ml-2 text-10 text-muted-foreground">{GROUP_STATUS_LABEL[o.group.status]}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupPanel({ group }: { group: Group }) {
  return (
    <Card data-testid="lc-group-panel">
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-14 font-medium" data-testid="lc-group-panel-name">{group.name}</span>
          {group.status !== "recording-ready" && (
            <StatChip tone="ai" testId="lc-group-panel-status">{GROUP_STATUS_LABEL[group.status]}</StatChip>
          )}
        </div>
        <p className="text-11 leading-relaxed text-muted-foreground" data-testid="lc-group-panel-scenario">
          {group.scenario}
        </p>
        <p className="text-10 text-muted-foreground">
          组员 {group.memberUserIds.length} 人{group.leaderUserId === null ? "（未指定组长）" : ""}
        </p>
      </div>
    </Card>
  );
}

function StageBar({
  segments,
  loading,
  error,
  stageControl,
  onAdvanced,
}: {
  segments: ListAgendaSegmentsOut | null;
  loading: boolean;
  error: string | null;
  stageControl: boolean;
  onAdvanced?: () => void;
}) {
  const [advancing, setAdvancing] = React.useState(false);
  const [advanceError, setAdvanceError] = React.useState<string | null>(null);

  const current = segments?.find((s) => s.state === "active") ?? null;
  // `ordinal` 契约里是 0-based nonnegative int（`z.number().int().nonnegative()`），
  // 界面上按 1-based 显示第几个环节，+1 即可，不需要再数一遍列表。
  const ordinal = current ? current.ordinal + 1 : null;
  const total = segments?.length ?? null;

  const runAdvance = React.useCallback(
    async (action: "advance" | "closeEarly" | "skip") => {
      if (!current) return;
      setAdvancing(true);
      setAdvanceError(null);
      try {
        await advanceAgendaSegment({
          workshopId: current.workshopId,
          segmentId: current.id,
          action,
          mergeIntoSegmentId: null,
        });
        onAdvanced?.();
      } catch (e: unknown) {
        setAdvanceError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
      } finally {
        setAdvancing(false);
      }
    },
    [current, onAdvanced],
  );

  return (
    <Card data-testid="project-live-stagebar">
      <div className="flex items-center gap-3 rounded-t-lg bg-inverse px-4 py-3 text-inverse-foreground">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
        <div className="min-w-0 flex-1">
          {loading && <div className="text-11 text-muted-foreground" data-testid="project-live-stagebar-loading">读取环节中…</div>}
          {!loading && error && (
            <div className="text-11 text-destructive" data-testid="project-live-stagebar-error">
              环节读取失败：{error}
            </div>
          )}
          {!loading && !error && current === null && (
            <div className="truncate text-14 font-medium" data-testid="project-live-stagebar-empty">
              当前没有进行中的环节
            </div>
          )}
          {!loading && !error && current !== null && (
            <>
              <div className="text-10 uppercase tracking-wide text-muted-foreground">
                环节 {ordinal}/{total}
              </div>
              <div className="truncate text-14 font-medium" data-testid="project-live-stagebar-title">
                {current.title}
              </div>
            </>
          )}
        </div>
        {current !== null && (
          <StatChip tone="ai" testId="project-live-stagebar-state">{AGENDA_SEGMENT_STATE_LABEL[current.state]}</StatChip>
        )}
      </div>
      {stageControl && current !== null && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5">
          {advanceError && (
            <span className="text-10 text-destructive" data-testid="project-live-advance-error">{advanceError}</span>
          )}
          <span className="flex-1" />
          <Button
            size="xs" variant="outline" disabled={advancing}
            data-testid="project-live-skip"
            onClick={() => void runAdvance("skip")}
          >
            跳过
          </Button>
          <Button
            size="xs" variant="outline" disabled={advancing}
            data-testid="project-live-close-early"
            onClick={() => void runAdvance("closeEarly")}
          >
            提前结束
          </Button>
          <Button
            size="xs" variant="primary" disabled={advancing}
            data-testid="project-live-next"
            onClick={() => void runAdvance("advance")}
          >
            下一环节
          </Button>
        </div>
      )}
    </Card>
  );
}
