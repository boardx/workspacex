"use client";
import * as React from "react";
import { Sparkles, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { InterruptCardShell } from "@/components/agent-interrupts/interrupt-card-shell";
import type { ConfirmIntentArgs } from "@/lib/agent-interrupts-types";

/**
 * 屏一：目标复述卡（confirm_intent）—— ui.md「屏一」。
 *
 * · 只读态：一句「理解」 + 真实假设（允许零条），两动作「继续」/「改假设」。
 * · 编辑态：每条假设变可编辑文本框 + 增删；提交 = 用新假设重新确认一次（UC-1 edit 分支）。
 * · 未确认前卡片下方不渲染任何后续工具调用卡（I-1 的可视化 —— 见下方占位说明区）。
 */
const TID = "agent-interrupt-confirm-intent";

export function ConfirmIntentCard({
  args,
  state,
  canWrite,
  initialEditing = false,
  decided,
  onContinue,
  onEditSubmit,
}: {
  args: ConfirmIntentArgs;
  state: UiState;
  canWrite: boolean;
  initialEditing?: boolean;
  /**
   * issue #3310 —— 这张卡是**已结束的确认记录**（服务端 `resolvedApprovals` 里的一条），
   * 不是一个还能操作的请求。此时既不给决策入口，也不再说「后续步骤在你确认前不会开始」
   * ——那句话此刻是假的。给一句「你当时选的是什么」，让用户认得出这就是自己点过的那一次。
   *
   * ⚠ 决策入口本身**保留但禁用**——#3244 已经裁过这一条（`workbench-restored-approval.tsx`
   * 的「a decided confirmation is kept as a finished record」逐字断言按钮在且 disabled）：
   * 留痕不是抹掉。这里去掉的只有那句「后续步骤在你确认前不会开始」——它此刻是假的。
   */
  decided?: { decision: "once" | "run" | "forever" | "deny" | "reject" | "edit" | null };
  /** 「继续」= UC-1 的 approve 分支。不传（预览路由）时按钮保留旧行为——纯展示、无副作用。 */
  onContinue?: () => void;
  /**
   * 「用新假设继续」= UC-1 的 edit 分支。
   *
   * issue #3310 ②：除了已过滤空行的假设数组（允许零条），还传出**可能被改过的
   * `understanding`**。人类实测那一条改的正是这句话里的一个词（舟山→中山），而此前
   * 这句话既不可编辑也不回传，模型上下文里的原文一个字没动 —— 用户以为改了，执行按原文继续。
   */
  onEditSubmit?: (edited: { understanding: string; assumptions: string[] }) => void;
}) {
  const [editing, setEditing] = React.useState(initialEditing);
  const [drafts, setDrafts] = React.useState<string[]>([...args.assumptions]);
  // issue #3310 ②：「我的理解」也是用户会改的那一句（舟山→中山）。空串一律回落到原文，
  // 不允许把这句话改没——契约要求它 `min(1)`。
  const [understandingDraft, setUnderstandingDraft] = React.useState(args.understanding);

  // 无权限：决策接口不可用，整卡走 denied 态（NO_WRITE_ROLE）
  const effectiveState: UiState = !canWrite && state === "default" ? "denied" : state;
  // 校验失败态：强制进入编辑态，展示服务器返回的校验错误
  const forceInvalid = state === "invalid";
  const isEditing = editing || forceInvalid;
  const shownDrafts = forceInvalid
    ? args.assumptions.map((a, i) => (i === 1 ? "" : a))
    : drafts;

  const nonBlank = shownDrafts.filter((d) => d.trim().length > 0).length;

  return (
    <InterruptCardShell
      testid={TID}
      title="确认一下我的理解，再开始"
      subtitle="未确认前，我不会执行任何后续动作。"
    >
      <StateShell
        state={effectiveState}
        skeletonRows={4}
        emptyHint="当前没有待确认的目标复述——AI 还没有发起这次中断。"
        errors={{ assumptions: "假设格式无效，请补全或删除空行后再提交；没有额外假设时可以全部删除。" }}
        denial={{ layer: "project", reason: "观察者可以查看这次复述，但不能替团队做确认。" }}
        depFailure={{ what: "决策写不进审计（AUDIT_SINK_UNAVAILABLE），本次确认已被安全拦下。" }}
        successMessage="已按当前理解继续执行"
      >
        <div className="flex flex-col gap-3" data-testid={`${TID}-card`}>
          {/* 理解文本 */}
          <div className="flex flex-col gap-1">
            <span className="text-11 font-medium text-muted-foreground">我的理解</span>
            {!isEditing ? (
              <p className="text-13 leading-relaxed text-card-foreground" data-testid={`${TID}-understanding`}>
                {args.understanding}
              </p>
            ) : (
              <Textarea
                value={understandingDraft}
                onChange={(e) => setUnderstandingDraft(e.target.value)}
                rows={2}
                data-testid={`${TID}-understanding-input`}
                className="min-h-0 text-13"
                aria-label="我的理解"
              />
            )}
          </div>

          {/* 假设列表 */}
          <div className="flex flex-col gap-2">
            <span className="text-11 font-medium text-muted-foreground">
              我做了这些假设（{isEditing ? nonBlank : args.assumptions.length} 条）
            </span>
            {!isEditing ? (
              <ul className="flex flex-col gap-1.5">
                {args.assumptions.map((a, i) => (
                  <li
                    key={i}
                    data-testid={`${TID}-assumption-${i}`}
                    className="flex gap-2 rounded-md border border-border-subtle bg-muted px-2.5 py-1.5 text-12 text-card-foreground"
                  >
                    <span className="shrink-0 font-medium text-muted-foreground">{i + 1}.</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-1.5">
                {shownDrafts.map((d, i) => (
                  <div key={i} className="flex items-start gap-1.5" data-testid={`${TID}-assumption-${i}`}>
                    <span className="mt-1.5 shrink-0 text-12 font-medium text-muted-foreground">{i + 1}.</span>
                    <Textarea
                      value={d}
                      onChange={(e) => {
                        const next = [...shownDrafts];
                        next[i] = e.target.value;
                        setDrafts(next);
                      }}
                      rows={2}
                      data-testid={`${TID}-assumption-input-${i}`}
                      className="min-h-0 flex-1 text-12"
                      aria-label={`假设 ${i + 1}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`删除假设 ${i + 1}`}
                      data-testid={`${TID}-assumption-remove-${i}`}
                      onClick={() => setDrafts(shownDrafts.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  data-testid={`${TID}-assumption-add`}
                  onClick={() => setDrafts([...shownDrafts, ""])}
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" />
                  加一条假设
                </Button>
              </div>
            )}
          </div>

          {/* 已结束的记录：说清楚这是哪一次、当时选了什么，不再给任何决策入口。 */}
          {decided ? <p
            className="rounded-md border border-border-subtle bg-muted px-2.5 py-1.5 text-11 text-muted-foreground"
            data-testid={`${TID}-decided-note`}
          >
            {decided.decision === "edit"
              ? "你已按修改后的内容确认过这一次——上面显示的就是被采纳的那一份。"
              : decided.decision === "reject" || decided.decision === "deny"
                ? "你已拒绝过这一次请求。"
                : "你已确认过这一次。"}
          </p> : null}

          {/* I-1 的可视化：未确认前后续动作被挡住 */}
          {decided ? null : <div
            className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5"
            data-testid={`${TID}-gated-notice`}
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-11 text-muted-foreground">
              后续步骤（拉取数据、生成报告…）在你确认前不会开始。
            </span>
          </div>}

          {/* 动作区 */}
          <div className="flex items-center justify-end gap-2">
            {!isEditing ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`${TID}-edit-toggle`}
                  disabled={!canWrite}
                  onClick={() => setEditing(true)}
                >
                  改假设
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-background-foreground text-background transition-colors duration-fast hover:bg-background-foreground/90"
                  data-testid={`${TID}-continue`}
                  disabled={!canWrite}
                  onClick={() => onContinue?.()}
                >
                  继续
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`${TID}-edit-cancel`}
                  onClick={() => {
                    setEditing(false);
                    setDrafts([...args.assumptions]);
                    setUnderstandingDraft(args.understanding);
                  }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-background-foreground text-background transition-colors duration-fast hover:bg-background-foreground/90"
                  data-testid={`${TID}-edit-submit`}
                  disabled={!canWrite || forceInvalid}
                  onClick={() => onEditSubmit?.({
                    understanding: understandingDraft.trim().length > 0 ? understandingDraft : args.understanding,
                    assumptions: shownDrafts.filter((d) => d.trim().length > 0),
                  })}
                >
                  用新假设继续
                </Button>
              </>
            )}
          </div>
        </div>
      </StateShell>
    </InterruptCardShell>
  );
}
