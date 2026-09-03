"use client";

import * as React from "react";
import { CircleAlert, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { auth as authContract } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";
import { completePasswordReset, contractFieldIssues, isResetTokenInvalid } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * F21 找回密码第 4-5 步（issue #2602）——邮件里的重置链接落地页。
 *
 * 此前只有第 2 步（登录页「忘记密码」→ 发起请求，见 `login-form.tsx`）接了真实
 * 端点；`completePasswordReset` 契约与后端用例早就有（且测试齐全），但没有任何
 * 页面消费 `?token=`、调用它——链接发出去也无处可落。本组件补上这一段。
 *
 * 与 `link-activation.tsx` / `invite-activation.tsx`（同样是"拿一个一次性 token
 * 设密码"的落地页）同一套骨架：`Card` 外壳、`contractFieldIssues` 拆字段级错误、
 * `terminal` vs `unavailable` 两类失败分别对待。
 *
 * 安全形状：
 * · 伪造令牌与过期令牌服务端返回同一个 `RESET_TOKEN_INVALID`（E4，防止告诉持有
 *   猜测令牌的人"这个令牌是真的，只是过期了"）——这里也只渲染同一句。
 * · 成功后展示 `revokedSessionCount`（契约字段，不是猜的）：让用户知道其它设备
 *   已经全部登出，这正是这次重置要做的事。
 */
export function ResetPassword({ token }: { token: string | null }) {
  const [pwd, setPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<ResetFailure | null>(null);
  const [done, setDone] = React.useState<{ revokedSessionCount: number } | null>(null);

  if (!token) {
    return (
      <Card>
        <p role="alert" className="flex items-start gap-2 text-13 text-destructive" data-testid="reset-password-missing-token">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          链接不完整，请使用邮件里完整的重置链接。也可以回登录页重新申请一封。
        </p>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <div className="flex flex-col gap-3" data-testid="reset-password-success">
          <p className="flex items-start gap-2 text-13 text-success">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            密码已重置。为安全起见，已让 {done.revokedSessionCount} 台已登录设备重新登录，
            请用新密码登录。
          </p>
          <Button size="sm" variant="primary" onClick={() => window.location.assign("/login")} data-testid="reset-password-success-continue">
            前往登录
          </Button>
        </div>
      </Card>
    );
  }

  const mismatch = confirmPwd.length > 0 && pwd !== confirmPwd;
  const canSubmit = !submitting && pwd.length > 0 && confirmPwd.length > 0 && !mismatch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await doSubmit();
  }

  async function doSubmit() {
    if (pwd !== confirmPwd) {
      setError({ kind: "terminal", field: "confirm", message: "两次输入的密码不一致。" });
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const out = await completePasswordReset(token!, pwd);
      setDone({ revokedSessionCount: out.revokedSessionCount });
    } catch (err) {
      setError(describeResetFailure(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={submit} data-testid="reset-password-form" noValidate>
        <p className="text-12 text-muted-foreground" data-testid="reset-password-intro">
          设置这个账号的新密码。提交后，旧密码与全部已登录设备将立即失效。
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password-pwd">新密码</Label>
          <Input
            id="reset-password-pwd"
            type="password"
            value={pwd}
            onChange={(e) => {
              setPwd(e.currentTarget.value);
              if (error?.field === "password") setError(null);
            }}
            placeholder={`至少 ${authContract.AUTH_POLICY.passwordMinLen} 位`}
            disabled={submitting}
            aria-invalid={error?.field === "password"}
            data-testid="reset-password-pwd"
          />
          {error?.field === "password" && (
            <p role="alert" className="text-10 text-destructive" data-testid="err-reset-password-pwd">
              {error.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password-confirm">确认新密码</Label>
          <Input
            id="reset-password-confirm"
            type="password"
            value={confirmPwd}
            onChange={(e) => {
              setConfirmPwd(e.currentTarget.value);
              if (error?.field === "confirm") setError(null);
            }}
            disabled={submitting}
            aria-invalid={mismatch || error?.field === "confirm"}
            data-testid="reset-password-confirm"
          />
          {(mismatch || error?.field === "confirm") && (
            <p role="alert" className="text-10 text-destructive" data-testid="err-reset-password-confirm">
              两次输入的密码不一致。
            </p>
          )}
        </div>

        {error && error.field === null && (
          <div
            role="alert"
            className="flex flex-col gap-2"
            data-testid={error.kind === "unavailable" ? "reset-password-error-unavailable" : "reset-password-error"}
          >
            <p className="flex items-start gap-2 text-12 text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error.message}
            </p>
            {error.kind === "unavailable" && (
              <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => void doSubmit()} data-testid="reset-password-retry">
                重试
              </Button>
            )}
            {error.kind === "terminal" && error.reason === "token-invalid" && (
              <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign("/login")} data-testid="reset-password-goto-login">
                返回登录页重新申请
              </Button>
            )}
          </div>
        )}

        <Button type="submit" size="sm" variant="primary" disabled={!canSubmit} data-testid="reset-password-submit">
          {submitting ? (
            <>
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> 正在提交…
            </>
          ) : (
            "设置新密码"
          )}
        </Button>
      </form>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
      <header className="flex items-center gap-2">
        <KeyRound aria-hidden className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-16 font-semibold tracking-tight">重置密码</h1>
      </header>
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">{children}</div>
    </div>
  );
}

/**
 * 失败三类，界面形状各异：
 *   字段级（password）             → 就地字段文案（弱口令/太短，同 registration/activate 的既有文案）；
 *   `terminal`（令牌失效）         → 明确失效 + 「返回登录页重新申请」，重试没有意义（同一个令牌不会变有效）；
 *   `unavailable`                  → 服务不可达/5xx，显式重试（同 invite-activation/link-activation 既有做法）；
 *     令牌在这条路径上**未被消耗**（`completePasswordReset` 先消费令牌再改密码，
 *     一次成功的消费不可能同时抛 5xx——见后端 `password-reset.ts` 的顺序注释），
 *     所以这里的重试是安全的，不会撞上"令牌已用过"。
 */
type ResetFailure =
  | { kind: "field"; field: "password"; message: string }
  | { kind: "terminal"; field: "confirm" | null; reason?: "token-invalid"; message: string }
  | { kind: "unavailable"; field: null; message: string };

function describeResetFailure(err: unknown): ResetFailure {
  const issues = contractFieldIssues(err);
  if (issues?.some((i) => i.path === "newPassword")) {
    return {
      kind: "field",
      field: "password",
      message: `密码不符合要求：至少 ${authContract.AUTH_POLICY.passwordMinLen} 位，且不能是常见泄露口令。`,
    };
  }
  if (isResetTokenInvalid(err)) {
    return {
      kind: "terminal",
      field: null,
      reason: "token-invalid",
      message: "重置链接无效或已失效（可能已过期、已使用过，或已重新申请了新链接）。请回登录页重新申请一封。",
    };
  }
  if (err instanceof ApiError && err.status >= 500) {
    return { kind: "unavailable", field: null, message: UNAVAILABLE_MESSAGE };
  }
  if (err instanceof ApiError) {
    return {
      kind: "unavailable",
      field: null,
      message: `重置未完成（${err.reasonCode ?? `HTTP ${err.status}`}），请稍后重试。`,
    };
  }
  // 非 ApiError ⇒ 请求根本没得到一个 HTTP 响应（连接拒绝/断网/超时）。
  return { kind: "unavailable", field: null, message: UNAVAILABLE_MESSAGE };
}

const UNAVAILABLE_MESSAGE = "服务暂时不可用，请稍后重试。这次失败不会消耗你的重置链接。";
