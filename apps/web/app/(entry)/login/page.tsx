import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { Avatar } from "@/components/ui/avatar";
import { LoginForm } from "@/components/entry/login-form";
import { LOGIN_BRAND } from "@/lib/mock/entry";

/**
 * 登录页（UC-1.1 R8「登录主屏」）——两栏：左表单区、右品牌氛围区。
 * 七态经 `?state=` 走完；交互（显示密码 / 忘记密码）下沉到 `LoginForm` 客户端组件。
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { state?: string };
}) {
  const state = resolvePreviewState(searchParams.state);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-3 p-4">
      {/* dev 预览条：生产不渲染 */}
      <div className="flex flex-col gap-1">
        <StatePreviewSwitcher current={state} />
        <p className="text-10 text-muted-foreground">
          当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
        </p>
      </div>

      <div className="grid flex-1 overflow-hidden rounded-lg border border-border shadow-sm md:grid-cols-2">
        {/* ── 左：表单区 ─────────────────────────────────────────── */}
        <div className="flex flex-col justify-center gap-6 bg-card p-8">
          <header className="flex flex-col gap-1.5">
            <span className="text-11 font-medium uppercase tracking-widest text-muted-foreground">
              WorkspaceX
            </span>
            <h1 className="text-24 font-semibold tracking-tight">进入你的战略工作空间</h1>
            <p className="text-13 text-muted-foreground">与你的 AI 团队一起，把最难的问题拆开。</p>
          </header>
          <LoginForm state={state} />
        </div>

        {/* ── 右：品牌 / 活动感氛围区 ───────────────────────────── */}
        <aside
          className="hidden flex-col justify-between gap-6 bg-panel-alt p-8 md:flex"
          data-testid="login-brand"
        >
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-11 text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              正在进行中 · {LOGIN_BRAND.liveStat}
            </span>
            <blockquote className="text-18 font-medium leading-relaxed">
              “{LOGIN_BRAND.quote}”
            </blockquote>
          </div>

          <div className="flex flex-col gap-2" data-testid="login-activity-stream">
            <p className="text-11 font-medium text-muted-foreground">此刻，你的 AI 团队在做</p>
            {LOGIN_BRAND.activities.map((a) => (
              <div
                key={a.initials}
                data-testid={`login-activity-${a.initials.toLowerCase()}`}
                className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-card p-2.5"
              >
                <Avatar initials={a.initials} tone="ai" size="sm" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-12 font-medium">{a.name}</span>
                  <span className="text-11 text-muted-foreground">{a.line}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
