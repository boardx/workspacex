"use client";
import * as React from "react";
import Link from "next/link";
import { ShieldCheck, Undo2, FileWarning, UserCog, ArrowLeft } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CONSENT, WITHDRAWAL_FLOW } from "@/lib/mock/entry";

/**
 * 受访者同意书（档案第九节 A / UC-1.2 D-13）——「被记录的人，自己也要有一块屏」。
 *
 * 两块内容：
 *  1. 逐项同意（录音 / 转文字稿 / 实名引用），拒绝任何一项都不影响访谈进行；
 *  2. **撤回是一条真实的数据流**（D-13 五步全画），撤回属危险动作，二次确认 + 影响范围说明。
 */
export function ConsentForm({ state }: { state: UiState }) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONSENT.items.map((i) => [i.id, i.defaultChecked])),
  );
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [ackImpact, setAckImpact] = React.useState(false);
  const [withdrawn, setWithdrawn] = React.useState(false);

  // ── 七态优先 ────────────────────────────────────────────────────────
  if (state !== "default") {
    return (
      <StateShell
        state={state}
        className="flex flex-col gap-4"
        skeletonRows={4}
        emptyHint="研究方还没为这场访谈配置同意书条款，请稍候或联系合规联系人"
        errors={{ confirm: "请先逐项确认，或选择「全部拒绝」——未确认不能开始访谈" }}
        depFailure={{ what: "同意书条款 / 合规配置服务暂时不可用，你的勾选已保留，可安全重试" }}
        denial={{ layer: "project", reason: "这条同意书链接已失效或不属于你，请联系合规联系人" }}
        successMessage="已记录你的选择，正在进入访谈…"
      >
        <ConsentBody
          checked={checked}
          onToggle={(id, v) => setChecked((s) => ({ ...s, [id]: v }))}
        />
      </StateShell>
    );
  }

  // ── 撤回流：危险动作，独立于七态驱动 ────────────────────────────────
  if (withdrawing) {
    return (
      <div className="flex flex-col gap-4" data-testid="consent-withdraw-panel">
        <button
          type="button"
          onClick={() => {
            setWithdrawing(false);
            setAckImpact(false);
            setWithdrawn(false);
          }}
          data-testid="consent-withdraw-back"
          className="inline-flex items-center gap-1 self-start text-12 text-muted-foreground transition-colors duration-200 hover:text-background-foreground"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> 返回同意书
        </button>

        {withdrawn ? (
          <div
            role="status"
            data-testid="consent-withdraw-done"
            className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-4"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden className="h-4 w-4 text-success" />
              <span className="text-14 font-semibold">撤回申请已提交</span>
            </div>
            <p className="text-12 text-muted-foreground">
              文字稿与音频已进入待删除队列，相关引述将在 5 分钟内退出检索。
              引用过它的报告段落会被标为「证据已撤回」而非删除；若已支撑过已签字决策，会通知拍板人复核。
              收到撤回后我们<strong className="font-medium">立即启动</strong>处理，各环节的完成状态可在
              处理进度页随时查看；<strong className="font-medium">30 天内</strong>完成物理删除并给你回执。
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <Undo2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="flex flex-col gap-1">
                <span className="text-14 font-semibold">你要撤回这场访谈的同意</span>
                <p className="text-12 text-muted-foreground">
                  撤回不是「删掉一段录音」这么简单——它会沿着这条数据流走完五步，影响范围如下。
                  这不可逆，请看清楚再确认。
                </p>
              </div>
            </div>

            {/* D-13 五步数据流：全部画出，03/04 显著区分 */}
            <ol className="flex flex-col gap-2" data-testid="consent-withdraw-flow">
              {WITHDRAWAL_FLOW.map((s) => (
                <li
                  key={s.no}
                  data-testid={`consent-withdraw-step-${s.no}`}
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
              data-testid="consent-withdraw-ack"
              label="我已了解上述影响范围，确认撤回"
              description="尤其是：已发布的报告段落会被标为「证据已撤回」，已签字决策会转人工复核。"
            />

            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="lg"
                disabled={!ackImpact}
                onClick={() => setWithdrawn(true)}
                data-testid="consent-withdraw-confirm"
              >
                确认撤回同意
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setWithdrawing(false)} data-testid="consent-withdraw-cancel">
                再想想
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── default 态 ──────────────────────────────────────────────────────
  const allDeclined = CONSENT.items.every((i) => !checked[i.id]);
  return (
    <div className="flex flex-col gap-5">
      <ConsentBody checked={checked} onToggle={(id, v) => setChecked((s) => ({ ...s, [id]: v }))} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" asChild data-testid="consent-confirm">
            <Link href="/studio/interview">
              {allDeclined ? "全部拒绝，仍进入访谈" : "确认并进入访谈"}
            </Link>
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setChecked(Object.fromEntries(CONSENT.items.map((i) => [i.id, false])))}
            data-testid="consent-decline-all"
          >
            全部拒绝
          </Button>
        </div>
        <p className="text-11 text-muted-foreground">
          未确认即不能开始。拒绝任何一项都不影响访谈进行——不勾「实名引用」时，报告里只会写「{CONSENT.alias}」。
        </p>
      </div>

      <Separator />

      {/* 撤回入口（危险动作，显式且带影响范围，不是孤零零的红按钮） */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-panel p-3" data-testid="consent-withdraw-entry">
        <div className="flex flex-col gap-0.5">
          <span className="text-12 font-medium">改主意了？你可以随时撤回</span>
          <span className="text-11 text-muted-foreground">
            撤回会沿五步数据流处理你的录音与引述，点开可看完整影响范围。
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setWithdrawing(true)} data-testid="consent-withdraw-open">
          <Undo2 aria-hidden className="h-3.5 w-3.5" /> 撤回同意
        </Button>
      </div>

      {/* 数据控制方 */}
      <footer className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-3" data-testid="consent-controller">
        <span className="text-11 font-medium text-muted-foreground">数据控制方</span>
        <p className="text-12">
          {CONSENT.controller.org} · 联系人 {CONSENT.controller.contact}。
          你也可以直接联系我们的合规邮箱{" "}
          <span className="font-mono text-11">{CONSENT.controller.email}</span>。
        </p>
      </footer>
    </div>
  );
}

/** 同意书正文（逐项勾选）——default 与七态成功/校验共用 */
function ConsentBody({
  checked,
  onToggle,
}: {
  checked: Record<string, boolean>;
  onToggle: (id: string, v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="consent-body">
      <p className="text-12 text-muted-foreground">
        被记录的人，自己也要有一块屏。下面每一项都由你决定，逐项勾选即可。
      </p>
      <ul className="flex flex-col gap-2">
        {CONSENT.items.map((item) => (
          <li
            key={item.id}
            className="rounded-md border border-border-subtle bg-panel p-3"
            data-testid={`consent-item-${item.id}`}
          >
            <Checkbox
              checked={!!checked[item.id]}
              onChange={(e) => onToggle(item.id, e.currentTarget.checked)}
              data-testid={`consent-check-${item.id}`}
              label={
                <span className="flex items-center gap-2">
                  {item.label}
                  {item.id === "realname" && !checked[item.id] && (
                    <Badge tone="neutral">当前：只用代称「{CONSENT.alias}」</Badge>
                  )}
                </span>
              }
              description={item.desc}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
