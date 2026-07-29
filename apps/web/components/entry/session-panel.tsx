"use client";
import * as React from "react";
import { Radio, Square, FileText, Undo2, ShieldCheck, Check } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SESSION, type SessionScene } from "@/lib/mock/entry";
import { SessionAuthorizations } from "./session-authorizations";
import { SessionWithdraw } from "./session-withdraw";

/**
 * 受访者会话屏主体（裁决 D-U10）——**刻意极简**，受访者不是产品用户。
 * 只做三件事：现在正在发生什么 / 我授权了什么 / 我可以做什么。
 *
 * 七态经 StateShell（`?state=`）；撤回是独立于七态的危险动作分支（走 SessionWithdraw）。
 * denied 态 = 一次性令牌失效（UC-6.3），文案在 page 传入。
 */
export function SessionPanel({ state, scene }: { state: UiState; scene: SessionScene }) {
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [transcriptAsked, setTranscriptAsked] = React.useState(false);

  // ── 七态优先 ────────────────────────────────────────────────────────
  if (state !== "default") {
    return (
      <StateShell
        state={state}
        className="flex flex-col gap-4"
        skeletonRows={4}
        emptyHint="这条链接还没有关联到进行中的访谈场次——请在约定时间用同一条链接回来"
        errors={{ consent: "你的改动没能记录，尚未生效；请重试，或直接联系下方合规联系人" }}
        depFailure={{ what: "授权与撤回依赖合规配置服务，暂时不可用；你的选择已保留，可安全重试" }}
        denial={{ layer: "project", reason: "这条链接已失效或不属于你，请联系合规联系人" }}
        successMessage="已更新你的授权选择，回执已记录"
      >
        <SessionAuthorizations />
      </StateShell>
    );
  }

  // ── 撤回：危险动作，独立分支 ────────────────────────────────────────
  if (withdrawing) {
    return <SessionWithdraw onBack={() => setWithdrawing(false)} />;
  }

  // ── default 态 ──────────────────────────────────────────────────────
  const recording = scene === "recording";
  return (
    <div className="flex flex-col gap-5">
      {/* 1 · 现在正在发生什么 */}
      <section
        data-testid="session-status"
        className={
          "flex flex-col gap-2 rounded-lg border p-4 " +
          (recording ? "border-destructive/30 bg-destructive/5" : "border-border-subtle bg-panel")
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {recording ? (
            <>
              <Radio aria-hidden className="h-4 w-4 text-destructive" />
              <span className="text-14 font-semibold">录音中</span>
              <span
                className="font-mono text-12 text-muted-foreground"
                data-testid="session-status-elapsed"
              >
                · 已 {SESSION.elapsed}
              </span>
            </>
          ) : (
            <>
              <Square aria-hidden className="h-4 w-4 text-muted-foreground" />
              <span className="text-14 font-semibold">本场已结束</span>
            </>
          )}
        </div>
        <p className="text-12 text-muted-foreground">
          {recording ? SESSION.purpose : SESSION.endedNote}
        </p>
        {recording && (
          <p className="text-11 text-muted-foreground">
            留存期：录音存于 {SESSION.controller.org} 的服务器，
            <strong className="font-medium text-background-foreground">
              {SESSION.retentionDays} 天后自动删除
            </strong>
            。
          </p>
        )}
      </section>

      {/* 2 · 我授权了什么 */}
      <SessionAuthorizations />

      <Separator />

      {/* 3 · 我可以做什么 */}
      <section className="flex flex-col gap-2" data-testid="session-actions">
        <h2 className="text-14 font-semibold">我可以做什么</h2>

        <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3" data-testid="session-transcript">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-12 font-medium">要一份我的文字稿副本</span>
              <span className="text-11 text-muted-foreground">{SESSION.transcriptDelivery}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTranscriptAsked(true)}
              disabled={transcriptAsked}
              title={transcriptAsked ? "已受理，无需重复申请" : undefined}
              data-testid="session-transcript-request"
            >
              <FileText aria-hidden className="h-3.5 w-3.5" />
              {transcriptAsked ? "已受理" : "要一份副本"}
            </Button>
          </div>
          {transcriptAsked && (
            <p
              role="status"
              data-testid="session-transcript-receipt"
              className="inline-flex items-center gap-1.5 text-11 text-success"
            >
              <Check aria-hidden className="h-3 w-3" />
              已受理你的文字稿副本申请，整理完成后按上述方式送达。
            </p>
          )}
        </div>

        {/* 撤回入口（危险动作，显式且带影响范围提示，不是孤零零的红按钮） */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"
          data-testid="session-withdraw-entry"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-12 font-medium">撤回全部记录</span>
            <span className="text-11 text-muted-foreground">
              沿五步数据流处理你的录音与引述，不可逆；点开先看完整影响范围。
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setWithdrawing(true)}
            data-testid="session-withdraw-open"
          >
            <Undo2 aria-hidden className="h-3.5 w-3.5" /> 撤回全部记录
          </Button>
        </div>
      </section>

      {/* 数据控制方 */}
      <footer
        className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-3"
        data-testid="session-controller"
      >
        <span className="inline-flex items-center gap-1 text-11 font-medium text-muted-foreground">
          <ShieldCheck aria-hidden className="h-3 w-3" /> 数据控制方
        </span>
        <p className="text-12">
          {SESSION.controller.org} · 联系人 {SESSION.controller.contact}。有任何疑问可直接联系合规邮箱{" "}
          <span className="font-mono text-11">{SESSION.controller.email}</span>。
        </p>
      </footer>
    </div>
  );
}
