"use client";
import * as React from "react";
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

/**
 * 现场协作主持台（F963，2026-08-19）—— 从「原型是手写 mock」接上真实数据。
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
 * ⚠ 四视角差异目前只剩「谁能推进环节」一件事（`stageControl`=facilitator）——
 *   组长/组员/观察者原本靠 `ownGroup`/`seesAllRaw` 分流的「本组可见/别组脱敏」
 *   逻辑，连同它作用的那组 mock 数据一起降级，等 F964（画布进度接线）落地后
 *   再按真实数据重新画出角色差异，不在这里补一份基于假数据的假差异。
 */
export function TabLive({
  view,
  readOnly = false,
  liveSegments = null,
  liveSegmentsLoading = false,
  liveSegmentsError = null,
  onAdvanced,
}: {
  view: ProjectRole;
  readOnly?: boolean;
  liveSegments?: ListAgendaSegmentsOut | null;
  liveSegmentsLoading?: boolean;
  liveSegmentsError?: string | null;
  onAdvanced?: () => void;
}) {
  const stageControl = ROLE_STAGE_CONTROL[view] && !readOnly;
  const isObserver = observerHidden(view);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" data-testid="project-live">
      <StageBar
        segments={liveSegments}
        loading={liveSegmentsLoading}
        error={liveSegmentsError}
        stageControl={stageControl}
        onAdvanced={onAdvanced}
      />

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
    </div>
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
