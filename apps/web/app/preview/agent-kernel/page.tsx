import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AGENT_KERNEL_UNITS, MOCK_PERMISSION_REQUEST, type AgentKernelUnit } from "@/lib/mock/agent-kernel";
import {
  PlanConfirmationCard, ProgressStream, ToolPermissionCard, InterjectionComposer,
  ArtifactsPanel, ErrorCard, ReconnectToast, PausedState,
} from "@/components/agent-kernel/agent-kernel-units";

/**
 * Phase 14 agent-kernel-unification —— UI 先行原型入口（ADR-003 / ADR-023 第 ① 件材料）。
 *
 * 纯 mock，不接后端。这些界面单元生产环境落在 /chat 三栏骨架内（宿主屏归 chat 束），
 * 此预览页只为逐屏签核把 8 个界面单元单独铺出来，并提供状态切换入口。
 *
 * query：
 *   ?unit= 01-plan-confirmation | 02-progress-stream | 03-tool-permission |
 *          04-interjection | 05-artifacts | 06-error-card | 07-reconnect | 08-paused
 *   ?state= 子状态（部分单元支持，如 05 的 empty、07 的 reconnecting、08 的 system）
 */

const UNIT_KEYS = AGENT_KERNEL_UNITS.map((u) => u.key);

function resolveUnit(raw: string | undefined): AgentKernelUnit {
  return (UNIT_KEYS.includes(raw as AgentKernelUnit) ? raw : "01-plan-confirmation") as AgentKernelUnit;
}

function renderUnit(unit: AgentKernelUnit, state: string | undefined) {
  switch (unit) {
    case "01-plan-confirmation": return <PlanConfirmationCard />;
    case "02-progress-stream": return <ProgressStream />;
    // `risk: "L2"` 收窄同 `agent-kernel-units.tsx` 那一处的注记：`ToolPermissionCardRequest`
    // 的 `risk` 是契约字面量 `"L2"`，不是 mock 用的宽联合 `TodoRisk`。
    case "03-tool-permission": return <ToolPermissionCard request={{ ...MOCK_PERMISSION_REQUEST, risk: "L2" }} />;
    case "04-interjection": return <InterjectionComposer />;
    case "05-artifacts": return <ArtifactsPanel empty={state === "empty"} />;
    case "06-error-card": return <ErrorCard />;
    case "07-reconnect": return <ReconnectToast state={state === "reconnecting" || state === "failed" ? state : "restored"} />;
    case "08-paused": return <PausedState variant={state === "system" ? "system" : "user"} />;
  }
}

export default function AgentKernelPreviewPage({
  searchParams,
}: {
  searchParams: { unit?: string; state?: string };
}) {
  const unit = resolveUnit(searchParams.unit);
  const meta = AGENT_KERNEL_UNITS.find((u) => u.key === unit)!;

  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-20 font-semibold tracking-tight">Phase 14 · agent-run 界面单元原型</h1>
          <p className="text-12 text-muted-foreground">
            真实组件 + mock 数据，可点可交互。8 个界面单元对应 requirements 各文件 R8 界面线索。
          </p>
        </header>

        {/* 单元切换器 */}
        <nav data-testid="unit-switcher" className="flex flex-wrap gap-1.5">
          {AGENT_KERNEL_UNITS.map((u) => (
            <Link
              key={u.key}
              href={`/preview/agent-kernel?unit=${u.key}`}
              data-testid={`unit-tab-${u.key}`}
              className={cn(
                "rounded-control border px-2.5 py-1 text-12 transition-colors duration-base",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                u.key === unit
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-input hover:text-background-foreground",
              )}
            >
              {u.label}
            </Link>
          ))}
        </nav>

        {/* 当前单元说明 */}
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <span className="text-13 font-semibold">{meta.label}</span>
            <code className="rounded-control bg-muted px-1.5 py-0.5 text-10 text-muted-foreground">{meta.runStatus}</code>
          </div>
          <p className="text-11 text-muted-foreground">来源：{meta.source}</p>
          <StateLinks unit={unit} activeState={searchParams.state} />
        </div>

        {/* 单元渲染舞台 */}
        <section
          data-testid="unit-stage"
          className="flex min-h-[24rem] items-start justify-center rounded-container border border-dashed border-border bg-muted/30 p-6"
        >
          {renderUnit(unit, searchParams.state)}
        </section>
      </div>
    </main>
  );
}

/** 部分单元有子状态切换 */
function StateLinks({ unit, activeState }: { unit: AgentKernelUnit; activeState?: string }) {
  const options: Record<string, { key: string | undefined; label: string }[]> = {
    "05-artifacts": [
      { key: undefined, label: "有版本历史" },
      { key: "empty", label: "空态" },
    ],
    "07-reconnect": [
      { key: undefined, label: "已恢复" },
      { key: "reconnecting", label: "重连中" },
      { key: "failed", label: "重连失败" },
    ],
    "08-paused": [
      { key: undefined, label: "用户主动暂停" },
      { key: "system", label: "系统保护性暂停" },
    ],
  };
  const list = options[unit];
  if (!list) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-10 text-muted-foreground">状态：</span>
      {list.map((o) => {
        const isActive = (o.key ?? "") === (activeState ?? "");
        const href = o.key ? `/preview/agent-kernel?unit=${unit}&state=${o.key}` : `/preview/agent-kernel?unit=${unit}`;
        return (
          <Link
            key={o.label}
            href={href}
            data-testid={`state-tab-${unit}-${o.key ?? "default"}`}
            className={cn(
              "rounded-control border px-2 py-0.5 text-10 transition-colors duration-base",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isActive ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-input",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
