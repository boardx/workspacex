"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import { CircleAlert, DoorOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import { auth as authContract, orgAdmin } from "@repo/contracts";
import { ApiError, apiRequest, getStoredSessionToken } from "@/lib/api-client";
import { contractFieldIssues } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/entry/auth-shell";
import { useInvitationSession, INVITATION_COMPLETION_KEYS, type InvitationCompletion } from "./use-invitation-session";

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
  const { t } = useI18n();
  const [mode, setMode] = React.useState<"new" | "existing">(() => getStoredSessionToken() ? "existing" : "new");
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [pwd, setPwd] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<JoinFailure | null>(null);
  const [done, setDone] = React.useState<InvitationCompletion | null>(null);
  const completeSession = useInvitationSession();
  const hasSession = getStoredSessionToken() !== null;
  const loginUrl = `/login?next=${encodeURIComponent(`/auth/activate?lt=${encodeURIComponent(token)}`)}`;

  if (done) {
    return (
      <Card>
        <div className="flex flex-col gap-3" data-testid="link-activate-success">
          <p className="flex items-start gap-2 text-13 text-success">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {t(INVITATION_COMPLETION_KEYS[done])}
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.location.assign(done === "session-failed" ? "/login" : "/projects")}
            data-testid="link-activate-success-continue"
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

  async function doSubmit() {
    setError(null);
    setSubmitting(true);
    const initialToken = getStoredSessionToken();
    try {
      const result = await apiRequest<ActivateOut>((mode === "existing" ? orgAdmin.operations.acceptOrgInviteLink.path : orgAdmin.operations.activateViaOrgInviteLink.path), {
        method: "POST",
        sessionToken: mode === "existing" ? initialToken : null,
        body: mode === "existing" ? { token } : { token, email: email.trim(), profile: { name: name.trim(), password: pwd } },
      });
      setDone(await completeSession(result.session, initialToken, mode === "existing"));
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
        setDone("session-failed");
        return;
      }
      setError(describeJoinFailure(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting && (mode === "existing" ? hasSession : email.trim().length > 0 && name.trim().length > 0 && pwd.length > 0);

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={submit} data-testid="link-activate-form" noValidate>
        <div className="flex gap-1.5" data-testid="link-activate-mode">
          <Button type="button" size="sm" variant={mode === "new" ? "primary" : "outline"} onClick={() => setMode("new")} data-testid="link-activate-mode-new">{t("invitation.newUser")}</Button>
          <Button type="button" size="sm" variant={mode === "existing" ? "primary" : "outline"} onClick={() => setMode("existing")} data-testid="link-activate-mode-existing">{t("invitation.existingUser")}</Button>
        </div>
        {mode === "new" ? <>
        <p className="text-12 text-muted-foreground" data-testid="link-activate-intro">
          {t("invitation.sharedIntro")}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-activate-email">{t("invitation.email")}</Label>
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
              {t(error.message, error.params)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-activate-name">{t("invitation.name")}</Label>
          <Input
            id="link-activate-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={t("invitation.namePlaceholder")}
            disabled={submitting}
            data-testid="link-activate-name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-activate-pwd">{t("invitation.setPassword")}</Label>
          <Input
            id="link-activate-pwd"
            type="password"
            value={pwd}
            onChange={(e) => {
              setPwd(e.currentTarget.value);
              if (error?.field === "password") setError(null);
            }}
            placeholder={t("account.reset.placeholder", { min: authContract.AUTH_POLICY.passwordMinLen })}
            disabled={submitting}
            aria-invalid={error?.field === "password"}
            data-testid="link-activate-pwd"
          />
          {error?.field === "password" && (
            <p role="alert" className="text-10 text-destructive" data-testid="err-link-activate-pwd">
              {t(error.message, error.params)}
            </p>
          )}
        </div>

        </> : hasSession ? <p className="text-12 text-muted-foreground">{t("invitation.existingHint")}</p> :
          <p className="text-12 text-muted-foreground" data-testid="link-activate-existing-need-login">
            {t("invitation.needLogin").split("{login}").map((part, index) => <React.Fragment key={index}>{index > 0 ? <a className="text-primary underline" href={loginUrl}>{t("invitation.loginPage")}</a> : null}{part}</React.Fragment>)}
          </p>}
        {error && error.field === null && (
          <div
            role="alert"
            className="flex flex-col gap-2"
            data-testid={error.kind === "unavailable" ? "link-activate-error-unavailable" : "link-activate-error"}
          >
            <p className="flex items-start gap-2 text-12 text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t(error.message, error.params)}
            </p>
            {error.kind === "already-member" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => window.location.assign(loginUrl)}
                data-testid="link-activate-goto-login"
              >
                {t("account.goToLogin")}
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
                data-testid="link-activate-retry"
              >
                {t("state.retry")}
              </Button>
              </>
            )}
          </div>
        )}

        <Button type="submit" size="lg" variant="primary" disabled={!canSubmit} data-testid="link-activate-submit">
          {submitting ? (
            <>
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> {t("invitation.joining")}
            </>
          ) : (
            t(mode === "existing" ? "invitation.confirmJoin" : "invitation.createAndJoin")
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
      title={t("invitation.sharedTitle")}
      footer={t("invitation.sharedFooter")}
    >
      {children}
    </AuthShell>
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
  message: MessageKey; params?: MessageParams;
};

function describeJoinFailure(err: unknown): JoinFailure {
  const issues = contractFieldIssues(err);
  if (issues?.some((i) => i.path === "email")) {
    return { kind: "terminal", field: "email", message: "invitation.invalidEmail" };
  }
  if (issues?.some((i) => i.path === "profile.password")) {
    return {
      kind: "terminal",
      field: "password",
      message: "account.reset.policy", params: { min: authContract.AUTH_POLICY.passwordMinLen },
    };
  }
  if (err instanceof ApiError) {
    if (err.reasonCode === "INVITE_ALREADY_MEMBER") {
      return {
        kind: "already-member",
        field: null,
        message: "invitation.sharedExisting",
      };
    }
    if (err.reasonCode === "QUOTA_EXHAUSTED") {
      return {
        kind: "terminal",
        field: null,
        message: "invitation.quotaFull",
      };
    }
    if (err.reasonCode === "INVITE_NOT_FOUND") {
      // 防枚举：不存在/过期/已作废/待复核/已用满，服务端刻意不可分辨，这里也只说同一句。
      return {
        kind: "terminal",
        field: null,
        message: "invitation.sharedInvalid",
      };
    }
    if (err.status >= 500) return { kind: "unavailable", field: null, message: UNAVAILABLE_MESSAGE };
    return {
      kind: "terminal",
      field: null,
      message: "invitation.joinIncomplete", params: { reason: err.reasonCode ?? `HTTP ${err.status}` },
    };
  }
  return { kind: "unavailable", field: null, message: UNAVAILABLE_MESSAGE };
}

const UNAVAILABLE_MESSAGE: MessageKey = "invitation.unavailable";
