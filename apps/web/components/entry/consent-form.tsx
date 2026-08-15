"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Undo2, FileWarning, UserCog, ArrowLeft } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CONSENT, WITHDRAWAL_FLOW } from "@/lib/mock/entry";
import { WITHDRAWAL_SLA_SUMMARY } from "@/lib/withdrawal-flow";
import { useSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { setConsentDecision, type ConsentItem } from "@/lib/live-consent";

/**
 * 同意书条目 id → 契约的 `RecordingConsentItem`（issue #854）。
 *
 * `CONSENT.items` 是本屏的界面视图模型（`lib/mock/entry.ts`，label/desc/defaultChecked），
 * 与契约的封闭枚举（`packages/contracts/src/consent-item.ts`）不是同一份东西——
 * 契约当前是四项（`record`/`transcript`/`ai_analysis`/`attribution`），本屏只画了三项
 * （少 `ai_analysis`），那是 issue #820 的范围（UI 保真度），本次不动。
 * `realname` → `attribution` 是同一件事的两个名字：「实名引用」就是「署名引述」。
 */
const CONTRACT_ITEM: Record<string, ConsentItem> = {
  record: "record",
  transcript: "transcript",
  realname: "attribution",
};

/**
 * 受访者同意书（档案第九节 A / UC-1.2 D-13）——「被记录的人，自己也要有一块屏」。
 *
 * 两块内容：
 *  1. 逐项同意（录音 / 转文字稿 / 实名引用），拒绝任何一项都不影响访谈进行；
 *  2. **撤回是一条真实的数据流**（D-13 五步全画），撤回属危险动作，二次确认 + 影响范围说明。
 *
 * ## 提交是真实写（issue #854）
 *
 * 「确认并进入访谈」不再只是一个 `<Link>`——它对每一项勾选各发一次
 * `POST /recording/consent/decisions`（`lib/live-consent.ts`），全部成功后才导航到
 * `/session`。三者缺一不可：`projectId` / `sourceRefId` / `participantId` 决定
 * 这份同意落在哪一行 `recording_consent_cells`；鉴权是既有模型（`NO_PROJECT_ROLE`），
 * 提交者必须已登录且在该项目上有角色——这不是本文件发明的门，是 `setConsentDecision`
 * 契约本身的现状（见 `packages/contracts/src/recording.ts` 的 `C_REC_6`）。
 */
export function ConsentForm({
  state,
  projectId,
  sourceRefId,
  participantId,
}: {
  state: UiState;
  /** 这份同意书链接指向的项目/访谈/受访者。三者缺一即无法真实提交（见文件头注释）。 */
  projectId: string | null;
  sourceRefId: string | null;
  participantId: string | null;
}) {
  const router = useRouter();
  const session = useSession();
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONSENT.items.map((i) => [i.id, i.defaultChecked])),
  );
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [ackImpact, setAckImpact] = React.useState(false);
  const [withdrawn, setWithdrawn] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const handleSubmit = React.useCallback(async () => {
    if (!projectId || !sourceRefId || !participantId) {
      setSubmitError(
        "这条同意书链接缺少必要参数（项目 / 访谈 / 受访者），无法提交。请联系发出该链接的人重新生成。",
      );
      return;
    }
    if (!session.session) {
      setSubmitError("请先登录后再提交这份同意书——提交由你的账号代为记录这场授权。");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await Promise.all(
        CONSENT.items.map((item) =>
          setConsentDecision(
            {
              projectId,
              sourceRefId,
              participantId,
              item: CONTRACT_ITEM[item.id]!,
              state: checked[item.id] ? "granted" : "denied",
            },
            session.session!.sessionToken,
          ),
        ),
      );
      router.push("/session");
    } catch (e) {
      if (e instanceof ApiError && e.reasonCode === "NO_PROJECT_ROLE") {
        setSubmitError("你在这个项目上没有角色，无法代这场访谈提交授权。请联系项目引导师把你加入项目。");
      } else {
        setSubmitError("同意书提交失败，请稍后重试；你的勾选已保留。");
      }
      setSubmitting(false);
    }
  }, [projectId, sourceRefId, participantId, session.session, checked, router]);

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
              文字稿与音频已进入待删除队列，相关引述将在 {WITHDRAWAL_SLA_SUMMARY.logical} 内退出检索。
              引用过它的报告段落会被标为「证据已撤回」而非删除；若已支撑过已签字决策，会通知拍板人复核。
              我们将在 <strong className="font-medium">{WITHDRAWAL_SLA_SUMMARY.physical}</strong> 内完成物理删除并给你回执（裁决 D-15 第二级 SLA）。
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
          <Button
            variant="primary"
            size="lg"
            disabled={submitting}
            onClick={handleSubmit}
            data-testid="consent-confirm"
          >
            {submitting
              ? "正在提交…"
              : allDeclined
                ? "全部拒绝，仍进入访谈"
                : "确认并进入访谈"}
          </Button>
          <Button
            variant="outline"
            size="lg"
            disabled={submitting}
            onClick={() => setChecked(Object.fromEntries(CONSENT.items.map((i) => [i.id, false])))}
            data-testid="consent-decline-all"
          >
            全部拒绝
          </Button>
        </div>
        <p className="text-11 text-muted-foreground">
          未确认即不能开始。拒绝任何一项都不影响访谈进行——不勾「实名引用」时，报告里只会写「{CONSENT.alias}」。
        </p>
        {submitError !== null ? (
          <p data-testid="consent-submit-error" className="text-12 text-destructive">
            {submitError}
          </p>
        ) : null}
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
