import * as React from "react";
import { Button } from "@/components/ui/button";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState } from "@/lib/ui-state";
import { ConfirmIntentCard } from "@/components/agent-interrupts/confirm-intent-card";
import { FillParamsCard } from "@/components/agent-interrupts/fill-params-card";
import { ChooseOptionCard } from "@/components/agent-interrupts/choose-option-card";
import {
  INTERRUPT_ROLES,
  INTERRUPT_SCREENS,
  MOCK_CONFIRM_INTENT,
  MOCK_FILL_PARAMS,
  MOCK_OPTIONS_2,
  MOCK_OPTIONS_3,
  resolveRole,
  resolveScreen,
  roleDef,
} from "@/lib/mock/agent-interrupts";

/**
 * agent-interrupts 契约束 —— UI 先行原型入口（ADR-003 签核第 ① 件材料）。
 *
 * query（预览手段，非权限实现；生产构建下 state 恒 default、switcher 不渲染）：
 *   ?screen= confirm-intent | fill-params | choose-option
 *   ?as=     facilitator | lead | member | observer   （R5 委托 chat UC-0 的角色；观察者无写权）
 *   ?state=  default | loading | empty | invalid | dep-failed | denied | success
 *   ?variant= edit（confirm-intent 进入改假设态）| two（choose-option 2 张态）
 *             | selected（choose-option 预选中态）
 */
export default function AgentInterruptsPreviewPage({
  searchParams,
}: {
  searchParams: { screen?: string; as?: string; state?: string; variant?: string };
}) {
  const screen = resolveScreen(searchParams.screen);
  const role = resolveRole(searchParams.as);
  const state = resolvePreviewState(searchParams.state);
  const variant = searchParams.variant;
  const canWrite = roleDef(role).canWrite;

  const qs = (over: Record<string, string | undefined>) => {
    const base = { screen, as: role, state, variant };
    const merged = { ...base, ...over };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        {/* 屏切换 */}
        <div className="flex flex-wrap items-center gap-2" data-testid="agent-interrupts-screen-switcher">
          <span className="text-11 uppercase tracking-wide text-muted-foreground">屏</span>
          {INTERRUPT_SCREENS.map((s) => (
            <Button
              key={s.key}
              asChild
              size="xs"
              variant={s.key === screen ? "primary" : "ghost"}
              data-testid={`screen-switch-${s.key}`}
            >
              <a href={qs({ screen: s.key, variant: undefined })}>{s.label}</a>
            </Button>
          ))}
        </div>

        {/* 视角切换（预览手段，不是权限实现）*/}
        <div className="flex flex-wrap items-center gap-2" data-testid="agent-interrupts-role-switcher">
          <span className="text-11 uppercase tracking-wide text-muted-foreground">视角</span>
          {INTERRUPT_ROLES.map((r) => (
            <Button
              key={r.key}
              asChild
              size="xs"
              variant={r.key === role ? "primary" : "ghost"}
              data-testid={`role-switch-${r.key}`}
            >
              <a href={qs({ as: r.key })}>
                {r.label}
                {!r.canWrite ? "（只读）" : ""}
              </a>
            </Button>
          ))}
        </div>

        <StatePreviewSwitcher current={state} />

        {/* 屏级变体切换（每屏专属）*/}
        {screen === "confirm-intent" ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="agent-interrupts-variant-switcher">
            <span className="text-11 uppercase tracking-wide text-muted-foreground">变体</span>
            <Button asChild size="xs" variant={!variant ? "primary" : "ghost"} data-testid="variant-readonly">
              <a href={qs({ variant: undefined })}>只读</a>
            </Button>
            <Button asChild size="xs" variant={variant === "edit" ? "primary" : "ghost"} data-testid="variant-edit">
              <a href={qs({ variant: "edit" })}>改假设</a>
            </Button>
          </div>
        ) : null}
        {screen === "choose-option" ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="agent-interrupts-variant-switcher">
            <span className="text-11 uppercase tracking-wide text-muted-foreground">变体</span>
            <Button asChild size="xs" variant={!variant ? "primary" : "ghost"} data-testid="variant-three">
              <a href={qs({ variant: undefined })}>3 张</a>
            </Button>
            <Button asChild size="xs" variant={variant === "two" ? "primary" : "ghost"} data-testid="variant-two">
              <a href={qs({ variant: "two" })}>2 张</a>
            </Button>
            <Button asChild size="xs" variant={variant === "selected" ? "primary" : "ghost"} data-testid="variant-selected">
              <a href={qs({ variant: "selected" })}>预选中</a>
            </Button>
          </div>
        ) : null}

        {/* 卡片本体 —— 放进一个仿对话流的宿主框里 */}
        <div className="rounded-lg border border-border-subtle bg-panel p-4" data-testid="agent-interrupts-host">
          {screen === "confirm-intent" ? (
            <ConfirmIntentCard
              args={MOCK_CONFIRM_INTENT}
              state={state}
              canWrite={canWrite}
              initialEditing={variant === "edit"}
            />
          ) : screen === "fill-params" ? (
            <FillParamsCard fields={MOCK_FILL_PARAMS} state={state} canWrite={canWrite} />
          ) : (
            <ChooseOptionCard
              options={variant === "two" ? MOCK_OPTIONS_2 : MOCK_OPTIONS_3}
              state={state}
              canWrite={canWrite}
              initialSelectedId={variant === "selected" ? MOCK_OPTIONS_3[0]!.optionId : undefined}
            />
          )}
        </div>
      </div>
    </main>
  );
}
