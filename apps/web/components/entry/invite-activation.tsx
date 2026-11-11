"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import { CircleAlert, DoorOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import { auth as authContract, orgAdmin } from "@repo/contracts";
import { ApiError, apiRequest, getStoredSessionToken } from "@/lib/api-client";
import { contractFieldIssues } from "@/lib/auth";
import type { ActivationLinkClaims } from "@/lib/activation-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/entry/auth-shell";
import { useSession } from "@/components/session/session-provider";
import { useInvitationSession, INVITATION_COMPLETION_KEYS, type InvitationCompletion } from "./use-invitation-session";

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
 * · `claims` = 链接上实际带着的 `?org=&role=&team=`（issue #592）。它们**只**随激活
 *   请求的查询串原样上行，不参与任何判断、不进请求体、不渲染。服务端拿它们与邀请
 *   记录比对后往 `org_invite_tamper_attempts` 留痕——前端不转发，审计表就永远是空的。
 */
export function InviteActivation({
  token,
  inboxInviteId,
  claims,
}: {
  token: string | null;
  inboxInviteId?: string;
  claims?: ActivationLinkClaims;
}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<"new" | "existing">(() => inboxInviteId || getStoredSessionToken() ? "existing" : "new");
  const [name, setName] = React.useState("");
  const [pwd, setPwd] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<ActivationFailure | null>(null);
  const [done, setDone] = React.useState<InvitationCompletion | null>(null);
  const completeSession = useInvitationSession();
  const currentSession = useSession();

  const hasSession = getStoredSessionToken() !== null;
  const returnQuery = new URLSearchParams(inboxInviteId ? { [orgAdmin.INBOX_INVITE_PARAM]: inboxInviteId } : { t: token ?? "" });
  for (const [key, value] of Object.entries(claims ?? {})) if (value !== undefined) returnQuery.set(key, value);
  const loginUrl = `/login?next=${encodeURIComponent(`/auth/activate?${returnQuery.toString().replaceAll("+", "%20")}`)}`;

  if (!token && !inboxInviteId) {
    return (
      <Card>
        <p role="alert" className="flex items-start gap-2 text-13 text-destructive" data-testid="activate-missing-token">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {t("invitation.missingLink")}
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
            {t(INVITATION_COMPLETION_KEYS[done])}
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.location.assign(done === "session-failed" ? "/login" : "/projects")}
            data-testid="activate-success-continue"
          >
            {done === "session-failed" ? t("account.goToLogin") : t("invitation.workspace")}
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
    const initialToken = getStoredSessionToken();
    try {
      const result = await apiRequest<ActivateOut>((mode === "existing" ? orgAdmin.operations.acceptOrgInvite.path : orgAdmin.operations.activateOrgMember.path), {
        method: "POST",
        // ⚠ 只进查询串。契约 `activateOrgMember.in` 是 `.strict()` 的，把这三个塞进
        //   body 会被 `ZodBodyPipe` 直接 400——它们本来就不是输入，是留痕材料。
        query: claims,
        // 新用户分支不带会话；已有账号分支带 stored token（Guard 据此解析 principal，
        // body.sessionId 只是「我带着会话来」这一事实的契约形状，不是身份本身）。
        sessionToken: mode === "new" ? null : initialToken,
        body:
          mode === "new"
            ? { token, mode: "new-account", profile: { name: name.trim(), password: pwd }, sessionId: null }
            : inboxInviteId ? { inboxInviteId } : { token },
      });
      setDone(await completeSession(result.session, initialToken, mode === "existing"));
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
        setDone("session-failed");
        return;
      }
      setError(describeActivationFailure(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={submit} data-testid="activate-form">
        {!inboxInviteId && <div className="flex gap-1.5" data-testid="activate-mode">
          <Button type="button" size="sm" variant={mode === "new" ? "primary" : "outline"} onClick={() => setMode("new")} data-testid="activate-mode-new">
            {t("invitation.newUser")}
          </Button>
          <Button type="button" size="sm" variant={mode === "existing" ? "primary" : "outline"} onClick={() => setMode("existing")} data-testid="activate-mode-existing">
            {t("invitation.existingUser")}
          </Button>
        </div>}

        {mode === "new" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activate-name">{t("invitation.name")}</Label>
              <Input id="activate-name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder={t("invitation.namePlaceholder")} disabled={submitting} data-testid="activate-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activate-pwd">{t("invitation.setPassword")}</Label>
              <Input
                id="activate-pwd"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.currentTarget.value)}
                placeholder={t("account.reset.placeholder", { min: authContract.AUTH_POLICY.passwordMinLen })}
                disabled={submitting}
                data-testid="activate-pwd"
              />
            </div>
          </>
        ) : hasSession ? (
          <p className="text-12 text-muted-foreground" data-testid="activate-existing-hint">
            {t(inboxInviteId ? "notifications.inviteAccountHint" : "invitation.existingHint")}
          </p>
        ) : (
          <p className="text-12 text-muted-foreground" data-testid="activate-existing-need-login">
            {t("invitation.needLogin").split("{login}").map((part, index) => <React.Fragment key={index}>{index > 0 ? <a className="text-primary underline" href={loginUrl}>{t("invitation.loginPage")}</a> : null}{part}</React.Fragment>)}
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
              {t(error.message, error.params)}
            </p>
            {error.kind === "account-mismatch" && (
              <Button type="button" variant="outline" disabled={submitting} data-testid="activate-switch-account"
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    await currentSession.logout();
                    window.location.assign(loginUrl);
                  } catch {
                    setError({ kind: "unavailable", message: UNAVAILABLE_MESSAGE });
                    setSubmitting(false);
                  }
                }}>
                {t("invitation.switchAccount")}
              </Button>
            )}
            {error.kind === "unavailable" && (
              <>
              <a className="text-primary underline" href={loginUrl}>{t("invitation.loginRecovery")}</a>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => void doSubmit()}
                data-testid="activate-retry"
              >
                {t("state.retry")}
              </Button>
              </>
            )}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          variant="primary"
          disabled={submitting || (mode === "new" && (name.trim().length === 0 || pwd.length === 0)) || (mode === "existing" && !hasSession)}
          data-testid="activate-submit"
        >
          {submitting ? (
            <>
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> {t("invitation.activating")}
            </>
          ) : mode === "new" ? (
            t("invitation.createAndJoin")
          ) : (
            t("invitation.confirmJoin")
          )}
        </Button>
      </form>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <AuthShell
      icon={<DoorOpen aria-hidden className="h-5 w-5 text-muted-foreground" />}
      title={t("invitation.singleTitle")}
      footer={t("invitation.singleFooter")}
    >
      {children}
    </AuthShell>
  );
}

/** Unavailable responses can arrive after commit; provide retry and password-login recovery. */
type ActivationFailure = { kind: "unavailable" | "terminal" | "account-mismatch"; message: MessageKey; params?: MessageParams };

function describeActivationFailure(err: unknown): ActivationFailure {
  const issues = contractFieldIssues(err);
  if (issues?.some((i) => i.path === "profile.password")) {
    return {
      kind: "terminal",
      message: "account.reset.policy", params: { min: authContract.AUTH_POLICY.passwordMinLen },
    };
  }
  if (err instanceof ApiError) {
    if (err.reasonCode === "INVITE_ACCOUNT_MISMATCH") {
      return { kind: "account-mismatch", message: "invitation.accountMismatch" };
    }
    if (err.reasonCode === "INVITE_ALREADY_MEMBER") {
      return { kind: "terminal", message: "invitation.alreadyMember" };
    }
    if (err.reasonCode === "INVITE_NOT_FOUND") {
      // V10：无效/过期/已用/已撤销四因服务端刻意不可分辨，这里也只说同一句。
      return {
        kind: "terminal",
        message: "invitation.singleInvalid",
      };
    }
    if (err.status === 401) {
      return { kind: "terminal", message: "invitation.sessionExpired" };
    }
    if (err.status >= 500) {
      return { kind: "unavailable", message: UNAVAILABLE_MESSAGE };
    }
    return {
      kind: "terminal",
      message: "invitation.activationIncomplete", params: { reason: err.reasonCode ?? `HTTP ${err.status}` },
    };
  }
  // 非 ApiError ⇒ 请求根本没得到一个 HTTP 响应（连接拒绝/断网/超时）。
  return { kind: "unavailable", message: UNAVAILABLE_MESSAGE };
}

const UNAVAILABLE_MESSAGE: MessageKey = "invitation.unavailable";
