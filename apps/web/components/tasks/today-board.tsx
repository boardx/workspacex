"use client";
import * as React from "react";
import { PlugZap } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import { Button } from "@/components/ui/button";
import type { UiState } from "@/lib/ui-state";
import {
  JudgmentCardView,
  PushCardView,
  RunningCardView,
  WaitingCardView,
} from "./task-card";
import {
  JUDGMENT_CARDS,
  PUSH_CARDS,
  RUNNING_CARDS,
  WAITING_CARDS,
  TODAY_SUMMARY,
  TODAY_SUMMARY_LOW_SAMPLE,
} from "@/lib/mock/tasks";

/** 四语义分区骨架（固定存在、顺序固定、空区也渲染，D-29 硬约束）*/
function Section({
  id,
  title,
  count,
  hint,
  children,
}: {
  id: string;
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={`tasks-section-${id}`}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-14 font-semibold">{title}</h2>
        <span className="text-12 text-muted-foreground" data-testid={`tasks-section-count-${id}`}>{count}</span>
        {hint && <span className="text-11 text-muted-foreground">（{hint}）</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * 分区级依赖失败（③ 区的 agent 运行态服务不可用，其余三区照常，UC-11.5 E1/V14）
 *
 * ⚠ 分区级降级是**刻意的**——整屏空白会让另外三区本来可用的任务也看不见。
 *   但它仍必须挂**固定保留 testid `dep-failed`**：七态契约要求「屏处于该态时保留名可被选中」，
 *   与降级粒度无关。只挂 `tasks-section-dep-failed` 会让该屏在七态矩阵里被判为漏做。
 *   两个 testid 并存：保留名给验收锚定，域名给定位具体分区。
 */
function SectionDepFailed() {
  return (
    <div
      data-testid="dep-failed"
      data-section-testid="tasks-section-dep-failed"
      role="alert"
      className="flex flex-col items-center gap-2 rounded-md border border-warning/30 bg-warning/5 py-6 text-center"
    >
      <PlugZap aria-hidden className="h-5 w-5 text-warning" />
      <p className="text-12 font-medium">agent 运行态服务暂时不可用</p>
      <p className="text-11 text-muted-foreground">
        本区数据源中断，其余三区照常。运行中断或超预算的任务会转入「等我判断」，不会静默显示为还在跑。
      </p>
      <Button size="sm" variant="outline" data-testid="tasks-section-dep-retry">重试</Button>
    </div>
  );
}

export function TodayBoard({ state }: { state: UiState }) {
  const depFailed = state === "dep-failed";
  // dep-failed 走分区级降级：整屏仍渲染，仅 ③ 区显示依赖失败。其余六态走 StateShell。
  const shellState: UiState = depFailed ? "default" : state;

  return (
    <div className="flex flex-col gap-5 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold tracking-tight">我的今天</h1>
        <p className="text-12 text-muted-foreground">
          最重要的是什么 · 下一步轮到谁 · 什么在等我判断。人和 AI 共用同一种任务对象，
          <strong className="text-background-foreground">责任人始终是人</strong>。
        </p>
      </header>

      <StateShell
        state={shellState}
        emptyHint="今天没有等你的事：四个分区都空了，去项目看板看看全量任务"
        onCreate={() => window.alert("演示：去项目看板")}
        errors={{ due: "「决定是否给第 4 组延时」的到期时间已过，请先改期或标记阻塞" }}
        denial={{ layer: "project", reason: "观察者不参与任务，「我的今天」对其不渲染" }}
        successMessage="已推进：路径 B 判断已记入，看板视图同步更新"
        skeletonRows={6}
      >
        <div className="flex flex-col gap-6">
          <Section
            id="awaiting-judgment"
            title="等我判断"
            count={JUDGMENT_CARDS.length}
            hint="AI 停在这里，不会绕过你继续"
          >
            <div className="flex flex-col gap-2">
              {JUDGMENT_CARDS.map((c) => (
                <JudgmentCardView key={c.id} card={c} />
              ))}
            </div>
          </Section>

          <Section id="push-today" title="今天该我推进" count={PUSH_CARDS.length}>
            <div className="flex flex-col gap-2">
              {PUSH_CARDS.map((c) => (
                <PushCardView key={c.id} card={c} />
              ))}
            </div>
          </Section>

          <Section
            id="ai-running"
            title="AI 正在替我跑"
            count={RUNNING_CARDS.length}
            hint="只给一行摘要 · token/读取文件数/内部步骤在任务详情的「执行」页"
          >
            {depFailed ? (
              <SectionDepFailed />
            ) : (
              <div className="flex flex-col gap-2">
                {RUNNING_CARDS.map((c) => (
                  <RunningCardView key={c.id} card={c} />
                ))}
              </div>
            )}
          </Section>

          <Section id="waiting-others" title="下一步轮到别人" count={WAITING_CARDS.length}>
            <div className="flex flex-col gap-2">
              {WAITING_CARDS.map((c) => (
                <WaitingCardView key={c.id} card={c} />
              ))}
            </div>
          </Section>

          <footer
            data-testid="tasks-today-summary"
            className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3"
          >
            <p className="text-12" data-testid="tasks-summary-folded">
              今日 AI 完成 {TODAY_SUMMARY.aiDone} 项、折算 {TODAY_SUMMARY.personHours} 人时；
              {TODAY_SUMMARY.waitingAuthz} 项停下等授权。
            </p>
            <p className="text-10 text-muted-foreground" data-testid="tasks-summary-coefficient-note">
              折算系数、口径表版本与最小样本量阈值由组织可配口径表提供；
              <strong className="text-background-foreground">这三个数值 UC 与原型均未给出（产品待定）</strong>，
              本屏不编造。O-37 定死的是三条原则：可配口径表 · 标注样本量与版本 · 样本不足显示「样本不足」。
            </p>
            {/* O-37 ③ 闸门的形态演示——阈值数值产品待定，此处只示「样本不足不显示折算值」 */}
            <p className="text-10 text-muted-foreground" data-testid="tasks-summary-low-sample-demo">
              示例（样本不足态）：今日 AI 完成 {TODAY_SUMMARY_LOW_SAMPLE.aiDone} 项 ·{" "}
              <span className="text-warning">{TODAY_SUMMARY_LOW_SAMPLE.label}</span>
            </p>
            <p className="text-11 font-medium text-background-foreground">{TODAY_SUMMARY.responsibilityNote}</p>
          </footer>
        </div>
      </StateShell>
    </div>
  );
}
