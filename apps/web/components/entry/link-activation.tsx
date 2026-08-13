"use client";

import * as React from "react";
import { CircleAlert, DoorOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import { auth as authContract, orgAdmin } from "@repo/contracts";
import { ApiError, apiRequest } from "@/lib/api-client";
import { contractFieldIssues } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ActivateOut = typeof orgAdmin.operations.activateViaOrgInviteLink.out._output;

/**
 * 组织共享邀请链接的加入页（shared-invite-links delta，`?lt=` 模式）。
 *
 * 与 `invite-activation.tsx`（单人 `?t=`）的差异：邮箱**自填**（共享链接不指向任何
 * 邮箱），只有建新号一条分支（OA12②：已有账号的人该去登录）。
 *
 * 安全形状：
 * · 失效各因（不存在/过期/已作废/待复核/已用满）服务端统一 `INVITE_NOT_FOUND`——
 *   这里也只渲染同一句，不猜原因、不回显组织名（防枚举，V10）。
 * · 配额满是**明确的另一句**（拍板①「文案指向配额」）：持有效链接的人该去找管理员
 *   调配额，而不是误以为链接坏了。
 * · 已有账号 → 明确拒绝并指向登录（拍板①查重，不重复建号）。
 */
export function LinkActivation({ token }: { token: string }) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [pwd, setPwd] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<JoinFailure | null>(null);
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <Card>
        <div className="flex flex-col gap-3" data-testid="link-activate-success">
          <p className="flex items-start gap-2 text-13 text-success">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            账号已创建并加入组织。请用刚才填写的邮箱和密码登录。
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.location.assign("/login")}
            data-testid="link-activate-success-continue"
          >
            前往登录
          </Button>
        </div>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await doSubmit();
  }

  async function doSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest<ActivateOut>(orgAdmin.operations.activateViaOrgInviteLink.path, {
        method: "POST",
        sessionToken: null,
        body: { token, email: email.trim(), profile: { name: name.trim(), password: pwd } },
      });
      setDone(true);
    } catch (err) {
      setError(describeJoinFailure(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting && email.trim().length > 0 && name.trim().length > 0 && pwd.length > 0;

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={submit} data-testid="link-activate-form" noValidate>
        <p className="text-12 text-muted-foreground" data-testid="link-activate-intro">
          你打开的是一条组织共享邀请链接。填写邮箱、姓名并设置密码，即可创建账号并加入组织。
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-activate-email">邮箱</Label>
          <Input
            id="link-activate-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.currentTarget.value);
              if (error?.field === "email") setError(null);
            }}
            placeholder="name@example.com"
            disabled={submitting}
            aria-invalid={error?.field === "email"}
            data-testid="link-activate-email"
          />
          {error?.field === "email" && (
            <p role="alert" className="text-10 text-destructive" data-testid="err-link-activate-email">
              {error.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-activate-name">姓名</Label>
          <Input
            id="link-activate-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="你的名字"
            disabled={submitting}
            data-testid="link-activate-name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-activate-pwd">设置密码</Label>
          <Input
            id="link-activate-pwd"
            type="password"
            value={pwd}
            onChange={(e) => {
              setPwd(e.currentTarget.value);
              if (error?.field === "password") setError(null);
            }}
            placeholder={`至少 ${authContract.AUTH_POLICY.passwordMinLen} 位`}
            disabled={submitting}
            aria-invalid={error?.field === "password"}
            data-testid="link-activate-pwd"
          />
          {error?.field === "password" && (
            <p role="alert" className="text-10 text-destructive" data-testid="err-link-activate-pwd">
              {error.message}
            </p>
          )}
        </div>

        {error && error.field === null && (
          <div
            role="alert"
            className="flex flex-col gap-2"
            data-testid={error.kind === "unavailable" ? "link-activate-error-unavailable" : "link-activate-error"}
          >
            <p className="flex items-start gap-2 text-12 text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error.message}
            </p>
            {error.kind === "already-member" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => window.location.assign("/login")}
                data-testid="link-activate-goto-login"
              >
                前往登录
              </Button>
            )}
            {error.kind === "unavailable" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => void doSubmit()}
                data-testid="link-activate-retry"
              >
                重试
              </Button>
            )}
          </div>
        )}

        <Button type="submit" size="sm" variant="primary" disabled={!canSubmit} data-testid="link-activate-submit">
          {submitting ? (
            <>
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> 加入中…
            </>
          ) : (
            "创建账号并加入组织"
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
        <DoorOpen aria-hidden className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-16 font-semibold tracking-tight">加入组织</h1>
      </header>
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">{children}</div>
      <p className="text-10 text-muted-foreground">
        授予的角色以服务端链接记录为准；本页不显示组织信息，加入成功后可在工作台看到。
      </p>
    </div>
  );
}

/**
 * 失败四类，界面形状各异：
 *   字段级（email/password）      → 就地字段文案；
 *   `already-member`              → 明确拒绝 + 前往登录（拍板①查重）；
 *   `terminal`（链接失效/配额满） → 各自的下一步，无重试按钮；
 *   `unavailable`                 → 服务不可达/5xx，显式重试（invite-activation 同款）。
 */
type JoinFailure = {
  kind: "terminal" | "unavailable" | "already-member";
  field: "email" | "password" | null;
  message: string;
};

function describeJoinFailure(err: unknown): JoinFailure {
  const issues = contractFieldIssues(err);
  if (issues?.some((i) => i.path === "email")) {
    return { kind: "terminal", field: "email", message: "邮箱格式不正确（服务端校验拒绝，未创建账号）。" };
  }
  if (issues?.some((i) => i.path === "profile.password")) {
    return {
      kind: "terminal",
      field: "password",
      message: `密码不符合要求：至少 ${authContract.AUTH_POLICY.passwordMinLen} 位，且不能是常见泄露口令。`,
    };
  }
  if (err instanceof ApiError) {
    if (err.reasonCode === "INVITE_ALREADY_MEMBER") {
      return {
        kind: "already-member",
        field: null,
        message: "该邮箱已有账号（或已是组织成员）。共享链接只用于创建新账号——请直接登录；若需要加入本组织，请联系管理员。",
      };
    }
    if (err.reasonCode === "QUOTA_EXHAUSTED") {
      return {
        kind: "terminal",
        field: null,
        message: "组织成员配额已满，暂时无法通过此链接加入。请联系组织管理员调整席位配额后再试。",
      };
    }
    if (err.reasonCode === "INVITE_NOT_FOUND") {
      // 防枚举：不存在/过期/已作废/待复核/已用满，服务端刻意不可分辨，这里也只说同一句。
      return {
        kind: "terminal",
        field: null,
        message: "链接无效或已失效（可能已过期、已被作废或人数已满）。请向分享链接的管理员索取新链接。",
      };
    }
    if (err.status >= 500) return { kind: "unavailable", field: null, message: UNAVAILABLE_MESSAGE };
    return {
      kind: "terminal",
      field: null,
      message: `加入未完成（${err.reasonCode ?? `HTTP ${err.status}`}），请稍后重试。`,
    };
  }
  return { kind: "unavailable", field: null, message: UNAVAILABLE_MESSAGE };
}

const UNAVAILABLE_MESSAGE =
  "服务暂时不可用（可能正在部署重启），请稍后重试。你的邀请链接不会因这次失败而失效。";
