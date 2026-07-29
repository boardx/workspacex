"use client";
import * as React from "react";
import { ShieldCheck, Undo2, FileWarning, UserCog, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { WITHDRAWAL_FLOW } from "@/lib/mock/entry";
import { WITHDRAWAL_SLA_SUMMARY } from "@/lib/withdrawal-flow";

/**
 * 受访者撤回全部记录——**危险且不可逆**（裁决 D-U10）。
 *
 * ⚠ 撤回沿用同意书里已有的那条五步影响链（`WITHDRAWAL_FLOW`），**直接复用数据，不另写一套**。
 *   含 D-U2 改过的 SLA（02/03 = 「立即启动 · 进度可查」），本组件只渲染、不改写时限。
 * ⚠ 沿用同意书的做法：勾「我已了解影响范围」后才解锁红色确认键。
 */
export function SessionWithdraw({ onBack }: { onBack: () => void }) {
  const [ackImpact, setAckImpact] = React.useState(false);
  const [done, setDone] = React.useState(false);

  return (
    <div className="flex flex-col gap-4" data-testid="session-withdraw-panel">
      <button
        type="button"
        onClick={onBack}
        data-testid="session-withdraw-back"
        className="inline-flex items-center gap-1 self-start text-12 text-muted-foreground transition-colors duration-200 hover:text-background-foreground"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> 返回
      </button>

      {done ? (
        <div
          role="status"
          data-testid="session-withdraw-done"
          className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-4"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="h-4 w-4 text-success" />
            <span className="text-14 font-semibold">撤回申请已提交</span>
          </div>
          <p className="text-12 text-muted-foreground">
            文字稿与音频已进入待删除队列，来自这场访谈的引述会退出检索。引用过它的报告段落会被标为
            「证据已撤回」而非静默删除；若已支撑过已签字决策，会通知拍板人复核。收到撤回后我们
            <strong className="font-medium">立即启动</strong>处理，各环节的完成状态可在处理进度页随时查看；
            <strong className="font-medium">{WITHDRAWAL_SLA_SUMMARY.physical}</strong> 内完成物理删除并给你回执。
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <Undo2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="flex flex-col gap-1">
              <span className="text-14 font-semibold">你要撤回这场访谈的全部记录</span>
              <p className="text-12 text-muted-foreground">
                撤回不是「删掉一段录音」这么简单——它会沿着这条数据流走完五步，影响范围如下。
                这不可逆，请看清楚再确认。
              </p>
            </div>
          </div>

          {/* 复用同意书的五步影响链；03/04 显著区分 */}
          <ol className="flex flex-col gap-2" data-testid="session-withdraw-flow">
            {WITHDRAWAL_FLOW.map((s) => (
              <li
                key={s.no}
                data-testid={`session-withdraw-step-${s.no}`}
                className={
                  "flex items-start gap-3 rounded-md border p-3 " +
                  (s.emphasis === "evidence"
                    ? "border-warning/40 bg-warning/5"
                    : s.emphasis === "human"
                      ? "border-ai/30 bg-ai-tint"
                      : "border-border-subtle bg-panel")
                }
              >
                <span className="font-mono text-12 font-semibold text-muted-foreground">{s.no}</span>
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-12">{s.step}</span>
                    {s.emphasis === "evidence" && (
                      <Badge tone="warning">
                        <FileWarning aria-hidden className="h-3 w-3" /> 标记不删除
                      </Badge>
                    )}
                    {s.emphasis === "human" && (
                      <Badge tone="ai">
                        <UserCog aria-hidden className="h-3 w-3" /> 通知拍板人复核
                      </Badge>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-11 text-muted-foreground">{s.sla}</span>
              </li>
            ))}
          </ol>

          <Checkbox
            checked={ackImpact}
            onChange={(e) => setAckImpact(e.currentTarget.checked)}
            data-testid="session-withdraw-ack"
            label="我已了解上述影响范围，确认撤回全部记录"
            description="尤其是：已发布的报告段落会被标为「证据已撤回」，已签字决策会转人工复核。"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              size="lg"
              disabled={!ackImpact}
              onClick={() => setDone(true)}
              data-testid="session-withdraw-confirm"
              title={ackImpact ? undefined : "先勾选「我已了解影响范围」才能撤回"}
            >
              确认撤回全部记录
            </Button>
            <Button variant="ghost" size="lg" onClick={onBack} data-testid="session-withdraw-cancel">
              再想想
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
