import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { AuthShell } from "@/components/entry/auth-shell";
import { LoginForm } from "@/components/entry/login-form";
import { LoginSessionGate } from "@/components/entry/login-session-gate";
import { LocalSessionHandoff } from "@/components/entry/local-session-handoff";

/**
 * 登录页（UC-1.1 R8「登录主屏」）——统一 `AuthShell`：左品牌栏（官方 logo）、右表单区。
 * 七态经 `?state=` 走完；交互（显示密码 / 忘记密码）下沉到 `LoginForm` 客户端组件。
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { state?: string; next?: string };
}) {
  const state = resolvePreviewState(searchParams.state);

  return (
    <LoginSessionGate next={searchParams.next}>
      <LocalSessionHandoff next={searchParams.next} />
      <AuthShell
        testId="login-main"
        title="登录 WorkspaceX"
        description="进入你的战略工作空间。"
        aside={
          // dev 预览条：生产不渲染（StatePreviewSwitcher 自身判 NODE_ENV）
          process.env.NODE_ENV === "production" ? null : (
            <div className="flex flex-col gap-1">
              <StatePreviewSwitcher current={state} />
              <p className="text-10 text-muted-foreground">
                当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
              </p>
            </div>
          )
        }
      >
        <LoginForm state={state} next={searchParams.next} />
      </AuthShell>
    </LoginSessionGate>
  );
}
