"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Mail } from "lucide-react";
import { auth as C } from "@repo/contracts";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RegisterInput = typeof C.operations.redeemInviteAndCreateOrg.in._input;
type RegisterOutput = typeof C.operations.redeemInviteAndCreateOrg.out._output;

export function Registration() {
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [formError, setFormError] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [cooling, setCooling] = React.useState(false);
  const [resendFailed, setResendFailed] = React.useState(false);

  React.useEffect(() => {
    if (!cooling) return;
    const timer = window.setTimeout(() => setCooling(false), C.AUTH_POLICY.resendCooldownSeconds * 1_000);
    return () => window.clearTimeout(timer);
  }, [cooling]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(false);
    const data = new FormData(event.currentTarget);
    const input: RegisterInput = {
      code: String(data.get("code") ?? "").replace(/\s/g, ""),
      email,
      password: String(data.get("password") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      orgName: String(data.get("orgName") ?? ""),
    };
    try {
      await apiRequest<RegisterOutput>("/auth/register", { method: "POST", sessionToken: null, body: input });
      setCooling(true);
      setQueued(true);
    } catch {
      setFormError(true);
    } finally {
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
          <h1 className="text-20 font-semibold">用邀请码创建组织</h1>
          <p className="mt-1 text-12 text-muted-foreground">注册完成后，我们会发送一次性邮箱验证链接。</p>
        </div>
        <Field label="14 位邀请码" name="code" minLength={C.AUTH_POLICY.inviteCodeLength} required />
        <Field label="组织名称" name="orgName" required />
        <Field label="你的姓名" name="displayName" required />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="registration-email">工作邮箱</Label>
          <Input id="registration-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
        </div>
        <Field label="密码（至少 12 位）" name="password" type="password" minLength={C.AUTH_POLICY.passwordMinLen} required />
        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting ? "正在创建…" : "创建组织"}
        </Button>
        {formError ? <p role="alert" className="text-12 text-destructive">注册暂时未完成，请检查信息后重试。</p> : null}
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
