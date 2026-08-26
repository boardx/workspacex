"use client";
import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { InterruptCardShell } from "@/components/agent-interrupts/interrupt-card-shell";
import type { ParamFieldPreview } from "@/lib/mock/agent-interrupts";
import { cn } from "@/lib/utils";

/**
 * 屏二：参数补全表单（fill_params）—— ui.md「屏二」。
 *
 * · AI 猜的字段（aiGuess !== null）单独高亮 + 依据文案（I-3：有猜测必有依据）。
 * · required && aiGuess === null 的字段：无高亮，走「必填未填」既有校验态。
 * · 提交文案随是否有改动切换：未改 →「接受」(approve)；有改动 →「应用」(edit)。
 * · 底部提示：appliedTo === "ledger-only" 时显示「本步骤执行中，改动将在完成后生效」。
 *
 * ⚠ AI 高亮走**中性**强调（左描边 + 浅底 + 中性徽标），不用彩色——本轮导入的
 *   新 UX 重设计「唯一彩色是 --danger」。与 ui.md 早稿「用 MessageBadge/ai-tint token」
 *   的差异是一处**待人类确认的设计决定**，见 ui-preview README。
 */
const TID = "agent-interrupt-fill-params";
type AppliedTo = "full-rerun" | "ledger-only";

export function FillParamsCard({
  fields,
  state,
  canWrite,
}: {
  fields: readonly ParamFieldPreview[];
  state: UiState;
  canWrite: boolean;
}) {
  const [dirty, setDirty] = React.useState(false);
  const [appliedTo, setAppliedTo] = React.useState<AppliedTo>("full-rerun");

  const effectiveState: UiState = !canWrite && state === "default" ? "denied" : state;
  const forceInvalid = state === "invalid";

  return (
    <InterruptCardShell
      testid={TID}
      title="开始前，帮我确认几个参数"
      subtitle="标了「AI 建议」的字段是我猜的，可直接改。"
    >
      <StateShell
        state={effectiveState}
        skeletonRows={5}
        emptyHint="当前没有待补全的参数——AI 还没有发起这次中断。"
        errors={{ cc_recipients: "「抄送对象」是必填项，请至少填一个邮箱后再提交。" }}
        denial={{ layer: "project", reason: "观察者可以看到这些参数，但不能替团队修改或提交。" }}
        depFailure={{ what: "决策写不进审计（AUDIT_SINK_UNAVAILABLE），本次提交已被安全拦下。" }}
        successMessage={
          appliedTo === "ledger-only" ? "改动已记账，本步骤完成后生效" : "已应用，正在重跑受影响的步骤"
        }
      >
        <div className="flex flex-col gap-3" data-testid={`${TID}-card`}>
          <div className="flex flex-col gap-2.5">
            {fields.map((f) => {
              const aiGuessed = f.aiGuess !== null;
              const blankRequired = forceInvalid && f.aiGuess === null && f.required;
              return (
                <div
                  key={f.name}
                  data-testid={`${TID}-field-${f.name}`}
                  className={cn(
                    "flex flex-col gap-1 rounded-md px-2.5 py-2",
                    // AI 猜的字段：中性强调（左描边 + 浅底），不用彩色
                    aiGuessed && "border-l-2 border-background-foreground/40 bg-muted",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <label htmlFor={`${TID}-input-${f.name}`} className="text-12 font-medium text-card-foreground">
                      {f.label}
                    </label>
                    {f.required ? <span className="text-11 text-muted-foreground">必填</span> : null}
                    {aiGuessed ? (
                      <Badge
                        tone="outline"
                        data-testid={`${TID}-ai-badge-${f.name}`}
                        title={f.rationale ?? undefined}
                      >
                        <Sparkles aria-hidden className="h-3 w-3" />
                        AI 建议
                      </Badge>
                    ) : null}
                  </div>

                  {/* 控件按值类型渲染 */}
                  {f.kind === "text" ? (
                    <Input
                      id={`${TID}-input-${f.name}`}
                      data-testid={`${TID}-input-${f.name}`}
                      defaultValue={(f.currentValue as string) ?? ""}
                      placeholder={f.aiGuess === null ? "请填写…" : undefined}
                      onChange={() => setDirty(true)}
                      className={cn("h-7 text-12", blankRequired && "border-destructive focus-visible:ring-destructive")}
                      aria-invalid={blankRequired || undefined}
                    />
                  ) : f.kind === "select" ? (
                    <Select
                      data-testid={`${TID}-input-${f.name}`}
                      options={f.options ?? []}
                      value={
                        f.options?.find((o) => o.label === (f.currentValue as string))?.value ??
                        f.options?.[0]?.value
                      }
                      onValueChange={() => setDirty(true)}
                      className="h-7"
                    />
                  ) : (
                    <Checkbox
                      id={`${TID}-input-${f.name}`}
                      data-testid={`${TID}-input-${f.name}`}
                      defaultChecked={Boolean(f.currentValue)}
                      onChange={() => setDirty(true)}
                      label={<span className="text-12">{f.currentValue ? "包含" : "不包含"}</span>}
                    />
                  )}

                  {/* 依据文案（I-3：有猜测必有依据）*/}
                  {aiGuessed && f.rationale ? (
                    <p
                      className="text-11 text-muted-foreground"
                      data-testid={`${TID}-rationale-${f.name}`}
                    >
                      依据：{f.rationale}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* 应用方式（UC-2 appliedTo：full-rerun / ledger-only）*/}
          {dirty ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle p-2.5" data-testid={`${TID}-applied-to`}>
              <span className="text-11 font-medium text-muted-foreground">改动应用方式</span>
              <div className="flex gap-1.5">
                {(["full-rerun", "ledger-only"] as AppliedTo[]).map((a) => (
                  <Button
                    key={a}
                    size="xs"
                    variant="outline"
                    className={appliedTo === a ? "bg-background-foreground text-background transition-colors duration-fast hover:bg-background-foreground/90 border-background-foreground" : undefined}
                    data-testid={`${TID}-applied-${a}`}
                    onClick={() => setAppliedTo(a)}
                  >
                    {a === "full-rerun" ? "立即重跑受影响步骤" : "只记账，完成后生效"}
                  </Button>
                ))}
              </div>
              {appliedTo === "ledger-only" ? (
                <p className="text-11 text-muted-foreground" data-testid={`${TID}-ledger-hint`}>
                  本步骤执行中，改动将在完成后生效。
                </p>
              ) : null}
            </div>
          ) : null}

          {/* 提交区 */}
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="bg-background-foreground text-background transition-colors duration-fast hover:bg-background-foreground/90"
              data-testid={`${TID}-submit`}
              disabled={!canWrite}
            >
              {dirty ? "应用" : "接受"}
            </Button>
          </div>
        </div>
      </StateShell>
    </InterruptCardShell>
  );
}
