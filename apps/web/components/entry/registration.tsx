"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Mail } from "lucide-react";
import { auth as C } from "@repo/contracts";
import { apiRequest } from "@/lib/api-client";
import {
  bootstrapFirstUser,
  isBootstrapUnavailable,
  isRegistrationEmailTaken,
  login,
} from "@/lib/auth";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RegisterInput = typeof C.operations.redeemInviteAndCreateOrg.in._input;
type RegisterOutput = typeof C.operations.redeemInviteAndCreateOrg.out._output;

export function Registration() {
  const session = useSession();
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [resending, setResending] = React.useState(false);
  const [cooling, setCooling] = React.useState(false);
  const [resendFailed, setResendFailed] = React.useState(false);

  // 邀请码**完全留空 = bootstrap 模式**（冷启动建首位管理员，UC 见 ADR「第一个用户成管理员」）。
  // 这段逻辑原本长在 `login-form.tsx` 的内联建组面板里（#452）；2026-08-04 人类裁决
  // 「创建组织统一到 /auth/register 独立页」，于是整段搬到这里。
  // ⚠ 搬而不是删——只把内联面板摘掉、不把 bootstrap 补进来，等于把 #452 刚上线的
  // 「第一个账号不需要邀请码」功能回归掉，那正是人类当前卡住的那件事。
  const trimmedCode = code.replace(/\s/g, "");
  const bootstrapMode = trimmedCode.length === 0;

  React.useEffect(() => {
    if (!cooling) return;
    const timer = window.setTimeout(() => setCooling(false), C.AUTH_POLICY.resendCooldownSeconds * 1_000);
    return () => window.clearTimeout(timer);
  }, [cooling]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const data = new FormData(event.currentTarget);
    const registration = {
      email,
      password: String(data.get("password") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      orgName: String(data.get("orgName") ?? ""),
    };

    if (!bootstrapMode) {
      try {
        const input: RegisterInput = { ...registration, code: trimmedCode };
        await apiRequest<RegisterOutput>("/auth/register", { method: "POST", sessionToken: null, body: input });
        setCooling(true);
        setQueued(true);
      } catch (e) {
        // ⚠ 400 INVITE_CODE_INVALID 的四种成因（不存在/已核销/过期/已撤销）在服务端被
        // 刻意抹平成同一个响应，任何区分都会按命中率削减 14 位码的搜索空间
        // （`auth-registration.controller.ts` 的注释是权威）。前端**不得**把它们显示成
        // 不同文案，也不得对码格式做本地预判后给不同措辞。
        // 而 409 EMAIL_TAKEN 反过来是**故意明确**的（UC-1.5 A2 要求引导用户去登录），
        // 不要为了「防枚举一致性」把它也做模糊——防枚举在 login / password-reset 上做。
        setFormError(
          isRegistrationEmailTaken(e)
            ? "该邮箱已注册，请返回登录后在组织内使用邀请码。"
            : "邀请码无效，或注册暂时未完成，请检查信息后重试。",
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    let bootstrapped = false;
    try {
      await bootstrapFirstUser(registration);
      bootstrapped = true;
      const out = await login(registration.email, registration.password);
      await session.startSession(out);
      window.location.assign("/projects");
    } catch (e) {
      if (bootstrapped) {
        // 账号事务已提交，只是会话没起来。**不能**再给一次 bootstrap 的机会（它是一次性的），
        // 给一条如实、可重试的出口：去登录页用刚设的凭据登录。
        setFormError("管理员已创建，请前往登录页用刚才的邮箱和密码登录。");
        setSubmitting(false);
        return;
      }
      // 已提交但 HTTP 响应丢失，是一个未知结果。用既有的 login 操作把它收敛：
      // 这个候选人赢了就登录成功；别人赢了就失败，且不暴露也不改变 bootstrap 状态。
      try {
        const out = await login(registration.email, registration.password);
        await session.startSession(out);
        window.location.assign("/projects");
        return;
      } catch {
        // 保留下面那条原始的 bootstrap 失败信息。login 的公开错误刻意不可枚举，
        // 不引入任何新的 API 语义。
      }
      setFormError(
        isBootstrapUnavailable(e)
          ? "已有管理员，请输入 14 位邀请码。"
          : isRegistrationEmailTaken(e)
            ? "该邮箱已注册，请返回登录。"
            : "创建服务暂时不可用，请稍后重试。",
      );
      setSubmitting(false);
    }
  }

  async function resend() {
    setResending(true);
    setResendFailed(false);
    try {
      await apiRequest("/auth/email-verifications/resend", {
        method: "POST", sessionToken: null, body: { email },
      });
      setCooling(true);
    } catch {
      setResendFailed(true);
    } finally {
      setResending(false);
    }
  }

  if (queued) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center p-6">
        <section className="flex w-full flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm" data-testid="registration-verification-queued">
          <div className="flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" aria-hidden />
            <h1 className="text-20 font-semibold">验证邮件已排队</h1>
          </div>
          <p className="text-13 text-muted-foreground">
            请打开发送到 <strong>{email}</strong> 的邮件，并在 {C.AUTH_POLICY.verificationLinkHours} 小时内完成验证。
          </p>
          <Button
            type="button"
            variant="outline"
            data-testid="registration-verification-resend"
            disabled={resending || cooling}
            onClick={() => void resend()}
          >
            {resending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {resending ? "正在重新排队…" : cooling ? `${C.AUTH_POLICY.resendCooldownSeconds} 秒后可再次发送` : "重新发送验证邮件"}
          </Button>
          {cooling ? (
            <p role="status" className="flex items-center gap-1 text-12 text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> 新邮件已排队，请检查收件箱。
            </p>
          ) : null}
          {resendFailed ? (
            <p role="alert" className="flex items-center gap-1 text-12 text-destructive">
              <CircleAlert className="h-4 w-4" aria-hidden /> 暂时无法重新发送，请稍后重试。
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center p-6">
      <form onSubmit={(event) => void submit(event)} className="flex w-full flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-20 font-semibold">创建组织</h1>
          <p className="mt-1 text-12 text-muted-foreground">
            {bootstrapMode
              ? "邀请码留空 = 创建本实例的首位管理员，创建后直接登录。"
              : "注册完成后，我们会发送一次性邮箱验证链接。"}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="registration-code">邀请码（首位管理员请留空）</Label>
          <Input
            id="registration-code"
            name="code"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            data-testid="registration-code"
          />
          <p className="text-12 text-muted-foreground">
            已输入 {trimmedCode.length}/{C.AUTH_POLICY.inviteCodeLength} 位。留空则创建首位管理员。
          </p>
        </div>
        <Field label="组织名称" name="orgName" required data-testid="registration-org-name" />
        <Field label="你的姓名" name="displayName" required data-testid="registration-display-name" />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="registration-email">工作邮箱</Label>
          <Input id="registration-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required data-testid="registration-email" />
        </div>
        <Field label="密码（至少 12 位）" name="password" type="password" minLength={C.AUTH_POLICY.passwordMinLen} required data-testid="registration-password" />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={submitting || (!bootstrapMode && trimmedCode.length !== C.AUTH_POLICY.inviteCodeLength)}
          title={!bootstrapMode && trimmedCode.length !== C.AUTH_POLICY.inviteCodeLength ? "邀请码必须是完整的 14 位，或完全留空" : undefined}
          data-testid="registration-submit"
        >
          {submitting ? "正在创建…" : bootstrapMode ? "创建首位管理员并登录" : "验证邀请码并创建"}
        </Button>
        {formError !== null ? <p role="alert" data-testid="registration-error" className="text-12 text-destructive">{formError}</p> : null}
        <a href="/login" className="text-12 text-muted-foreground underline underline-offset-4">返回登录</a>
      </form>
    </main>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  const { label, name, ...input } = props;
  const id = `registration-${name}`;
  return <div className="flex flex-col gap-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} name={name} {...input} /></div>;
}
