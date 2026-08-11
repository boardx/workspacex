"use client";

import * as React from "react";
import { CircleAlert, DoorOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import { auth as authContract, orgAdmin } from "@repo/contracts";
import { ApiError, apiRequest, getStoredSessionToken } from "@/lib/api-client";
import { contractFieldIssues } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ActivateOut = typeof orgAdmin.operations.activateOrgMember.out._output;

/**
 * 组织邀请激活落地页（UC-1.6 R3-6a/6b，invite-link-and-reads delta ①）。
 *
 * 此前 `POST /org-invites/activate` 只有 API 与原型（`org-admin/activate-screen.tsx`，
 * mock），没有真实页面——裁决 A 让管理员把链接转交受邀人之后，链接必须真的能落地，
 * 否则「激活链接」只是一个会 404 的字符串。本组件是那个落地：读 `?t=`，两分支
 * （新用户设姓名密码 / 已有账号确认加入），全部打真实端点。
 *
 * 安全形状（与 `org-invite.controller.ts` 一致）：
 * · 链接失效四因（无效/过期/已用/已撤销）服务端返回逐字节相同的 `INVITE_NOT_FOUND`
 *   （V10 防枚举）——这里也只渲染**同一句**，不猜原因。
 * · 本页**不回显**组织名/角色/任何成员信息：token 只证明「被邀请过」，组织的存在性
 *   不该由一个落地页替服务端泄露。授予内容恒为服务端记录值（AC5，篡改无效）。
 */
export function InviteActivation({ token }: { token: string | null }) {
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [name, setName] = React.useState("");
  const [pwd, setPwd] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<null | { mode: "new" | "existing" }>(null);

  const hasSession = getStoredSessionToken() !== null;

  if (!token) {
    return (
      <Card>
        <p role="alert" className="flex items-start gap-2 text-13 text-destructive" data-testid="activate-missing-token">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          链接不完整，请使用完整的邀请链接。可向邀请你的管理员重新索取。
        </p>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <div className="flex flex-col gap-3" data-testid="activate-success">
          <p className="flex items-start gap-2 text-13 text-success">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {done.mode === "new"
              ? "账号已创建并加入组织。请用刚才的邮箱（邀请所用邮箱）和密码登录。"
              : "已加入组织。重新进入工作台即可看到新组织。"}
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.location.assign(done.mode === "new" ? "/login" : "/projects")}
            data-testid="activate-success-continue"
          >
            {done.mode === "new" ? "前往登录" : "进入工作台"}
          </Button>
        </div>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest<ActivateOut>(orgAdmin.operations.activateOrgMember.path, {
        method: "POST",
        // 新用户分支不带会话；已有账号分支带 stored token（Guard 据此解析 principal，
        // body.sessionId 只是「我带着会话来」这一事实的契约形状，不是身份本身）。
        sessionToken: mode === "new" ? null : undefined,
        body:
          mode === "new"
            ? { token, mode: "new-account", profile: { name: name.trim(), password: pwd }, sessionId: null }
            : { token, mode: "existing-account", profile: null, sessionId: getStoredSessionToken() },
      });
      setDone({ mode });
    } catch (err) {
      setError(describeActivationFailure(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={submit} data-testid="activate-form">
        <div className="flex gap-1.5" data-testid="activate-mode">
          <Button type="button" size="sm" variant={mode === "new" ? "primary" : "outline"} onClick={() => setMode("new")} data-testid="activate-mode-new">
            我是新用户
          </Button>
          <Button type="button" size="sm" variant={mode === "existing" ? "primary" : "outline"} onClick={() => setMode("existing")} data-testid="activate-mode-existing">
            我已有账号
          </Button>
        </div>

        {mode === "new" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activate-name">姓名</Label>
              <Input id="activate-name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="你的名字" disabled={submitting} data-testid="activate-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activate-pwd">设置密码</Label>
              <Input
                id="activate-pwd"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.currentTarget.value)}
                placeholder={`至少 ${authContract.AUTH_POLICY.passwordMinLen} 位`}
                disabled={submitting}
                data-testid="activate-pwd"
              />
            </div>
          </>
        ) : hasSession ? (
          <p className="text-12 text-muted-foreground" data-testid="activate-existing-hint">
            将以当前登录账号加入邀请对应的组织。授予的角色与团队以邀请记录为准。
          </p>
        ) : (
          <p className="text-12 text-muted-foreground" data-testid="activate-existing-need-login">
            当前未登录。请先在<a className="text-primary underline" href="/login">登录页</a>登录，再回到本链接确认加入。
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 text-12 text-destructive" data-testid="activate-error">
            <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={submitting || (mode === "new" && (name.trim().length === 0 || pwd.length === 0)) || (mode === "existing" && !hasSession)}
          data-testid="activate-submit"
        >
          {submitting ? (
            <>
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> 激活中…
            </>
          ) : mode === "new" ? (
            "创建账号并加入组织"
          ) : (
            "确认加入组织"
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
        <h1 className="text-16 font-semibold tracking-tight">激活组织邀请</h1>
      </header>
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">{children}</div>
      <p className="text-10 text-muted-foreground">
        链接携带的任何组织/角色声明均以服务端邀请记录为准，篡改无效并会被审计。
      </p>
    </div>
  );
}

function describeActivationFailure(err: unknown): string {
  const issues = contractFieldIssues(err);
  if (issues?.some((i) => i.path === "profile.password")) {
    return `密码不符合要求：至少 ${authContract.AUTH_POLICY.passwordMinLen} 位，且不能是常见泄露口令。`;
  }
  if (err instanceof ApiError) {
    if (err.reasonCode === "INVITE_ALREADY_MEMBER") return "你已是该组织成员，直接登录即可。";
    if (err.reasonCode === "INVITE_NOT_FOUND") {
      // V10：无效/过期/已用/已撤销四因服务端刻意不可分辨，这里也只说同一句。
      return "链接无效或已失效（可能已过期、已被使用或已被撤销）。请联系邀请你的管理员重发。";
    }
    if (err.status === 401) return "会话已失效，请重新登录后再打开本链接。";
    return `激活未完成（${err.reasonCode ?? `HTTP ${err.status}`}），请稍后重试。`;
  }
  return "激活未完成，请检查网络后重试。";
}
