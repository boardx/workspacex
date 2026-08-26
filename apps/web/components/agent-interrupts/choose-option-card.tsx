"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { InterruptCardShell } from "@/components/agent-interrupts/interrupt-card-shell";
import type { OptionCard as OptionCardT } from "@/lib/mock/agent-interrupts";
import { cn } from "@/lib/utils";

/**
 * 屏三：多方案对比（choose_option）—— ui.md「屏三」。
 *
 * · 2–3 张等宽卡（I-5），每张固定三行对照：见效 / 投入 / 预计收益（顺序固定）。
 * · 点击整张卡即选中并立即 resume（无二次确认，「选中即 resume」）。
 * · resume 载荷用 optionId 回指（I-6），不用数组下标。
 * · 「都不要」逃生口（reject）：契约允许，是否渲染是待人类确认项——本原型渲染出来
 *   供人类核对，最终由签核裁定（见 ui-preview README checklist）。
 */
const TID = "agent-interrupt-choose-option";

/** 固定三项对照，顺序即 domain.md 值对象字段序 */
const COMPARISON_ROWS: readonly { key: keyof OptionCardT; label: string }[] = [
  { key: "timeToValue", label: "见效" },
  { key: "effort", label: "投入" },
  { key: "expectedReturn", label: "预计收益" },
];

export function ChooseOptionCard({
  options,
  state,
  canWrite,
  showDecline = true,
  initialSelectedId,
}: {
  options: readonly OptionCardT[];
  state: UiState;
  canWrite: boolean;
  showDecline?: boolean;
  initialSelectedId?: string;
}) {
  const [selected, setSelected] = React.useState<string | undefined>(initialSelectedId);

  const effectiveState: UiState = !canWrite && state === "default" ? "denied" : state;

  return (
    <InterruptCardShell
      testid={TID}
      title="有几条推进路线，选一条我就接着做"
      subtitle="点选一张卡即确认；也可以选择都不要。"
    >
      <StateShell
        state={effectiveState}
        skeletonRows={3}
        emptyHint="当前没有待选择的方案——AI 还没有发起这次中断。"
        errors={{ option: "刚才那组方案已过期（可能在另一个标签页里被选过），请刷新后重新选择。" }}
        denial={{ layer: "project", reason: "观察者可以看到这些方案，但不能替团队做选择。" }}
        depFailure={{ what: "决策写不进审计（AUDIT_SINK_UNAVAILABLE），本次选择已被安全拦下。" }}
        successMessage="已按所选方案继续，我这就展开对应的执行步骤"
      >
        <div className="flex flex-col gap-3" data-testid={`${TID}-card`}>
          <div
            className={cn(
              "grid gap-2",
              options.length === 2 ? "grid-cols-2" : "grid-cols-3",
            )}
          >
            {options.map((o) => {
              const isSel = selected === o.optionId;
              return (
                <button
                  key={o.optionId}
                  type="button"
                  disabled={!canWrite}
                  data-testid={`${TID}-option-${o.optionId}`}
                  data-selected={isSel || undefined}
                  onClick={() => setSelected(o.optionId)}
                  className={cn(
                    "flex flex-col gap-2 rounded-md border p-2.5 text-left transition-all duration-base",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    "disabled:cursor-not-allowed",
                    isSel
                      ? "border-2 border-background-foreground bg-muted"
                      : "border-2 border-border bg-card hover:bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-12 font-bold tracking-tight text-card-foreground">{o.title}</span>
                    {isSel ? (
                      <span
                        className="flex h-4 w-4 items-center justify-center rounded-full bg-background-foreground"
                        data-testid={`${TID}-selected-mark-${o.optionId}`}
                      >
                        <Check aria-hidden className="h-3 w-3 text-background" />
                      </span>
                    ) : null}
                  </div>
                  <dl className="flex flex-col gap-1">
                    {COMPARISON_ROWS.map((row) => (
                      <div key={row.key} className="flex flex-col gap-0.5">
                        <dt className="text-10 uppercase tracking-wide text-muted-foreground">{row.label}</dt>
                        <dd className="text-11 leading-snug text-card-foreground">{String(o[row.key])}</dd>
                      </div>
                    ))}
                  </dl>
                </button>
              );
            })}
          </div>

          {/* 逃生口（reject）——契约允许，渲染与否待人类拍板 */}
          {showDecline ? (
            <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
              <span className="text-11 text-muted-foreground">
                {selected ? "已选中一条，点选其它卡可改选。" : "点选任意一张卡即确认。"}
              </span>
              <Button
                size="sm"
                variant="outline"
                data-testid={`${TID}-decline`}
                disabled={!canWrite}
                className="border-destructive/40 text-destructive transition-colors duration-fast hover:bg-destructive/10 hover:text-destructive"
              >
                都不要
              </Button>
            </div>
          ) : null}
        </div>
      </StateShell>
    </InterruptCardShell>
  );
}
