import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { EntryPreviewSwitcher } from "@/components/entry/preview-switcher";
import { JoinForm } from "@/components/entry/join-form";
import { Badge } from "@/components/ui/badge";
import {
  JOIN_CONTEXT,
  JOIN_STEPS,
  JOIN_SCENES,
  GROUP_VIEW_ROLES,
  resolveJoinScene,
  resolveGroupRole,
} from "@/lib/mock/entry";

/**
 * 链接落地页（UC-1.2 R8「链接落地页（已画）」）——只问一件事：确认你是谁。
 * 未登录/免注册上下文的独立入口，不复用登录页，不套 AppShell。
 */
export default function JoinPage({
  searchParams,
}: {
  searchParams: { state?: string; scene?: string; as?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const scene = resolveJoinScene(searchParams.scene);
  const role = resolveGroupRole(searchParams.as);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-3 p-4">
      {/* dev 预览条 */}
      <div className="flex flex-col gap-1.5">
        <StatePreviewSwitcher current={state} />
        <div className="flex flex-wrap gap-1.5">
          <EntryPreviewSwitcher
            label="场景"
            param="scene"
            options={JOIN_SCENES}
            current={scene}
            testid="join-scene-switcher"
          />
          <EntryPreviewSwitcher
            label="视角"
            param="as"
            options={GROUP_VIEW_ROLES}
            current={role}
            testid="join-role-switcher"
          />
        </div>
        <p className="text-10 text-muted-foreground">
          当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
          （场景切换仅在默认态生效）
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm">
        {/* 头部：项目 + 组 + 题目 */}
        <header className="flex flex-col gap-2" data-testid="join-header">
          <span className="text-11 font-medium uppercase tracking-widest text-muted-foreground">
            WorkspaceX
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-20 font-semibold tracking-tight">{JOIN_CONTEXT.project}</h1>
            <Badge tone="primary">你在第 {JOIN_CONTEXT.groupNo} 组</Badge>
          </div>
          <p className="text-13 text-muted-foreground">
            题目：{JOIN_CONTEXT.topic} ｜ 组长 {JOIN_CONTEXT.groupLead} · 同组还有{" "}
            {JOIN_CONTEXT.teammates.join("、")}
          </p>
        </header>

        {/* 四步进场路径示意 */}
        <ol className="flex flex-wrap items-center gap-1.5" data-testid="join-steps">
          {JOIN_STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-panel px-2 py-0.5 text-10 text-muted-foreground">
                <span className="font-mono">{i + 1}</span>
                {s}
              </span>
              {i < JOIN_STEPS.length - 1 && (
                <span aria-hidden className="text-10 text-muted-foreground">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>

        <JoinForm state={state} scene={scene} role={role} />
      </div>
    </div>
  );
}
