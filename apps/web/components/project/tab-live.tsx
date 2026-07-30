"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionTitle, StatChip } from "./parts";
import {
  LIVE_STAGE, LIVE_GROUPS, ROLE_CAN_WRITE, ROLE_STAGE_CONTROL, ROLE_OWN_GROUP,
  ROLE_SEES_ALL_RAW, observerHidden, type ProjectRole,
} from "@/lib/mock/project";

/**
 * 现场协作（原型 isWsDuring · 主持台全场）—— 复用 rec/canvas 域的心智：
 * 四组并行、每组一路录音喂给本组推演模板、进度条、需要介入提示。
 * ⚠ 四视角显著不同（真的改变界面，不是换文案）：
 *   · 引导师：四组原始引述全可见 + 全场控制（切环节/+5min/介入/听任意组）。
 *   · 组长/组员：**只有本组（第 2 组）**看得到原始引述与操作；别组只显示进度聚合。无全场控制。
 *   · 观察者：所有组都只显示脱敏进度，原始引述与所有操作按钮都消失。
 */
export function TabLive({ view, readOnly = false }: { view: ProjectRole; readOnly?: boolean }) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  const stageControl = ROLE_STAGE_CONTROL[view] && !readOnly;
  const seesAllRaw = ROLE_SEES_ALL_RAW[view];
  const ownGroup = ROLE_OWN_GROUP[view];
  const isObserver = observerHidden(view);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" data-testid="project-live">
      {/* 主持台状态条 */}
      <Card data-testid="project-live-stagebar">
        <div className="flex items-center gap-3 rounded-t-lg bg-inverse px-4 py-3 text-inverse-foreground">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
          <div className="min-w-0 flex-1">
            <div className="text-10 uppercase tracking-wide text-muted-foreground">{LIVE_STAGE.segment}</div>
            <div className="truncate text-14 font-medium">{LIVE_STAGE.segmentTitle}</div>
          </div>
          {stageControl && (
            <StatChip tone="danger" testId="project-live-need-intervention">{LIVE_STAGE.needIntervention}</StatChip>
          )}
          <div className="shrink-0 text-right">
            <div className="font-mono text-18 tabular-nums">{LIVE_STAGE.countdown}</div>
            <div className="text-9 text-muted-foreground">剩余</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 text-11 text-muted-foreground">
          <span>{LIVE_STAGE.attendance}</span>
          {stageControl && (
            <>
              <span className="flex-1" />
              <Button size="xs" variant="outline" data-testid="project-live-extend">＋5 分钟</Button>
              <Button size="xs" variant="primary" data-testid="project-live-next">下一环节</Button>
            </>
          )}
        </div>
      </Card>

      <SectionTitle meta={
        isObserver ? "只读 · 脱敏聚合"
          : seesAllRaw ? "每组一路录音，实时喂给本组的推演模板"
            : "你能进的只有本组（第 2 组）；别组只显示进度"
      }>
        四组并行
      </SectionTitle>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="project-live-groups">
        {LIVE_GROUPS.map((g) => {
          const isOwn = ownGroup === g.id;
          const showRaw = seesAllRaw || (isOwn && !isObserver);
          const canActHere = !readOnly && !isObserver && (stageControl || isOwn);
          return (
            <Card
              key={g.id}
              data-testid={`project-live-group-${g.id}`}
              className={g.needs && showRaw ? "border-destructive/40" : isOwn ? "border-primary/40" : ""}
            >
              <div className="flex flex-col gap-2.5 p-3.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-12 font-medium">{g.name}</span>
                  {isOwn && <StatChip tone="ai">你在这组</StatChip>}
                  {g.needs && stageControl
                    ? <StatChip tone="danger">需要介入</StatChip>
                    : g.time && showRaw && <span className="shrink-0 font-mono text-10 text-muted-foreground">{g.time}</span>}
                </div>

                {/* 原始引述：仅有权看本组/全场的角色可见；其余看到脱敏占位 */}
                {showRaw ? (
                  <p className="text-11 leading-relaxed text-card-foreground">{g.quote}</p>
                ) : (
                  <p className="rounded-md bg-muted px-2.5 py-2 text-11 text-muted-foreground">
                    {isObserver ? "原始转写不在你的授权范围内 · 仅显示进度" : "别组原始转写不可见 · 仅显示进度聚合"}
                  </p>
                )}

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-10 text-muted-foreground">
                    <span>{g.canvas}</span>
                    <span className="font-mono">{g.fill}%</span>
                  </div>
                  <Progress value={g.fill} tone={g.fill < 30 ? "warning" : "primary"} />
                </div>

                {g.extra && showRaw && (
                  <p className="rounded-md bg-panel px-2.5 py-1.5 text-10 text-muted-foreground">{g.extra}</p>
                )}

                {canActHere && (
                  <div className="flex gap-1.5">
                    {g.needs && stageControl && <Button size="xs" variant="primary" data-testid={`project-live-nudge-${g.id}`}>推提示给组长</Button>}
                    {isOwn && canWrite && !stageControl && <Button size="xs" variant="primary" data-testid={`project-live-submit-${g.id}`}>提交本组产出</Button>}
                    <Button size="xs" variant="outline" data-testid={`project-live-listen-${g.id}`}>{stageControl ? "听这组" : "回到本组"}</Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
