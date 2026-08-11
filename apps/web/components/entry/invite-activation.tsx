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
  const [error, setError] = React.useState<ActivationFailure | null>(null);
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
    await doSubmit();
  }

  // 提交与「重试」共用同一条路径：重试不是另一种提交，只是同一次提交再来一遍。
  async function doSubmit() {
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
          <div
            role="alert"
            className="flex flex-col gap-2"
            data-testid={error.kind === "unavailable" ? "activate-error-unavailable" : "activate-error"}
          >
            <p className="flex items-start gap-2 text-12 text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error.message}
            </p>
            {error.kind === "unavailable" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => void doSubmit()}
                data-testid="activate-retry"
              >
                重试
              </Button>
            )}
          </div>
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

/**
 * 失败分两类，界面形状不同：
 *   `unavailable`  后端够不着（连接失败/超时）或后端 5xx——部署重启窗口的典型表现
 *                  （2026-08-12 devapp 实测：人类点激活链接撞上滚动部署得到裸 500）。
 *                  这一类**不是链接的问题**：激活是单一 PG 事务
 *                  （`pg-org-invite-repository.ts` I-1），任何一步失败令牌都不会被核销，
 *                  所以这里可以诚实承诺「你的链接不会因此失效」，并给显式重试按钮。
 *   `terminal`     服务端明确判定过的结果（链接失效/已是成员/口令不合规/会话失效）——
 *                  重试不会改变任何事，所以不给重试按钮，给的是各自的下一步。
 */
type ActivationFailure = { kind: "unavailable" | "terminal"; message: string };

function describeActivationFailure(err: unknown): ActivationFailure {
  const issues = contractFieldIssues(err);
  if (issues?.some((i) => i.path === "profile.password")) {
    return {
      kind: "terminal",
      message: `密码不符合要求：至少 ${authContract.AUTH_POLICY.passwordMinLen} 位，且不能是常见泄露口令。`,
    };
  }
  if (err instanceof ApiError) {
    if (err.reasonCode === "INVITE_ALREADY_MEMBER") {
      return { kind: "terminal", message: "你已是该组织成员，直接登录即可。" };
    }
    if (err.reasonCode === "INVITE_NOT_FOUND") {
      // V10：无效/过期/已用/已撤销四因服务端刻意不可分辨，这里也只说同一句。
      return {
        kind: "terminal",
        message: "链接无效或已失效（可能已过期、已被使用或已被撤销）。请联系邀请你的管理员重发。",
      };
    }
    if (err.status === 401) {
      return { kind: "terminal", message: "会话已失效，请重新登录后再打开本链接。" };
    }
    if (err.status >= 500) {
      return { kind: "unavailable", message: UNAVAILABLE_MESSAGE };
    }
    return {
      kind: "terminal",
      message: `激活未完成（${err.reasonCode ?? `HTTP ${err.status}`}），请稍后重试。`,
    };
  }
  // 非 ApiError ⇒ 请求根本没得到一个 HTTP 响应（连接拒绝/断网/超时）。
  return { kind: "unavailable", message: UNAVAILABLE_MESSAGE };
}

const UNAVAILABLE_MESSAGE =
  "服务暂时不可用（可能正在部署重启），请稍后重试。你的邀请链接不会因这次失败而失效。";
