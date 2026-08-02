"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowLeft, KeyRound } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AUTH_PROVIDERS_LATER, AUTH_POLICY, LOGIN_BRAND } from "@/lib/mock/entry";
import { login } from "@/lib/auth";
import { ApiError, storeSessionToken } from "@/lib/api-client";

/**
 * 登录表单（UC-1.1 R3/R8）——七态一律经 StateShell。
 *
 * - D-02：三个第三方按钮**保留视觉位但 disabled 并标 later**，旁注「phase-1 暂不开放」。
 * - 防枚举：校验失败只给一条「邮箱或密码不正确」，不区分邮箱不存在 / 密码错误。
 * - `[忘记密码？]`（R8「原型待补」：按钮在、点了没屏）在此补出接线与后续屏。
 * - `[创建组织]`（R8「原型待补」）同样补出：需 14 位邀请码的建组面板。
 */
export function LoginForm({ state }: { state: UiState }) {
  const router = useRouter();
  const [showPwd, setShowPwd] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [email, setEmail] = React.useState(state === "invalid" ? LOGIN_BRAND.sampleEmail : "");
  const [password, setPassword] = React.useState(state === "invalid" ? "••••••••" : "");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [forgot, setForgot] = React.useState(false);
  const [resetSent, setResetSent] = React.useState(false);
  const [createOrg, setCreateOrg] = React.useState(false);
  const [inviteCode, setInviteCode] = React.useState("");
  const [orgRequested, setOrgRequested] = React.useState(false);

  if (createOrg) {
    // 邀请码长度从契约取（AUTH_POLICY.inviteCodeLength），去掉空格后计数。
    // ⚠ 原来这里写死字面量，并在注释里自陈「契约无此项」——那句注释就是一份副本的自白。
    const codeLen = inviteCode.replace(/\s/g, "").length;
    const codeReady = codeLen === AUTH_POLICY.inviteCodeLength;
    return (
      <div className="flex flex-col gap-4" data-testid="login-create-org-panel">
        <button
          type="button"
          onClick={() => {
            setCreateOrg(false);
            setOrgRequested(false);
            setInviteCode("");
          }}
          data-testid="login-create-org-back"
          className="inline-flex items-center gap-1 self-start text-12 text-muted-foreground transition-colors duration-200 hover:text-background-foreground"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> 返回登录
        </button>
        <div className="flex flex-col gap-1">
          <h2 className="text-18 font-semibold">创建组织</h2>
          <p className="text-12 text-muted-foreground">
            phase-1 只对受邀企业开放。先输入我们发给你的 14 位邀请码，验证通过后再设管理员账号。
          </p>
        </div>
        {orgRequested ? (
          <div
            role="status"
            data-testid="login-create-org-done"
            className="flex flex-col gap-1 rounded-md border border-border bg-muted p-3"
          >
            <p className="text-13 font-medium">邀请码已受理，正在为你开通组织空间。</p>
            <p className="text-12 text-muted-foreground">
              开通后会向管理员邮箱发送首个登录链接（{AUTH_POLICY.resetLinkHours} 小时内有效）。你可以先关掉此页。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-invite-code">14 位邀请码</Label>
              <div className="relative">
                <KeyRound aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-invite-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.currentTarget.value)}
                  placeholder="例如 YY-2049-KELE-06"
                  className="pl-8 font-mono tracking-wide"
                  data-testid="login-invite-code"
                />
              </div>
              <p className="text-11 text-muted-foreground">
                已输入 {codeLen}/{AUTH_POLICY.inviteCodeLength} 位{codeReady ? " · 长度符合" : ""}。邀请码由远洋商务发放，一码一组织。
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-org-name">组织名称</Label>
              <Input id="login-org-name" placeholder="如 远洋咨询 · 战略事业部" data-testid="login-org-name" />
            </div>
            <Button
              variant="primary"
              size="lg"
              disabled={!codeReady}
              title={codeReady ? undefined : "请先输入完整的 14 位邀请码"}
              onClick={() => setOrgRequested(true)}
              data-testid="login-create-org-submit"
            >
              验证邀请码并创建
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (forgot) {
    return (
      <div className="flex flex-col gap-4" data-testid="login-forgot-panel">
        <button
          type="button"
          onClick={() => {
            setForgot(false);
            setResetSent(false);
          }}
          data-testid="login-forgot-back"
          className="inline-flex items-center gap-1 self-start text-12 text-muted-foreground transition-colors duration-200 hover:text-background-foreground"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> 返回登录
        </button>
        <div className="flex flex-col gap-1">
          <h2 className="text-18 font-semibold">找回密码</h2>
          <p className="text-12 text-muted-foreground">
            输入工作邮箱，我们发一封一次性重置链接（{AUTH_POLICY.resetLinkHours} 小时内有效）。
          </p>
        </div>
        {resetSent ? (
          <div
            role="status"
            data-testid="login-forgot-sent"
            className="flex flex-col gap-1 rounded-md border border-border bg-muted p-3"
          >
            <p className="text-13 font-medium">若该邮箱已注册，重置邮件已发出。</p>
            <p className="text-12 text-muted-foreground">
              为防止账号被探测，无论邮箱是否注册都显示同一句话。重置成功后旧密码与全部既有会话将失效。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-reset-email">工作邮箱</Label>
              <Input
                id="login-reset-email"
                type="email"
                placeholder={LOGIN_BRAND.sampleEmail}
                data-testid="login-forgot-email"
              />
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setResetSent(true)}
              data-testid="login-forgot-submit"
            >
              发送重置链接
            </Button>
            <p className="text-11 text-muted-foreground">
              重发冷却 60 秒 · 每日上限 5 次。
            </p>
          </div>
        )}
      </div>
    );
  }

  const form = (
    <div className="flex flex-col gap-4" data-testid="login-form">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">工作邮箱</Label>
        <Input
          id="login-email"
          type="email"
          placeholder={LOGIN_BRAND.sampleEmail}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          data-testid="login-email"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">密码</Label>
          <button
            type="button"
            onClick={() => setForgot(true)}
            data-testid="login-forgot-link"
            className="text-11 text-muted-foreground transition-colors duration-200 hover:text-background-foreground"
          >
            忘记密码？
          </button>
        </div>
        <div className="relative">
          <Input
            id="login-password"
            type={showPwd ? "text" : "password"}
            placeholder="至少 12 位"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            className="pr-14"
            data-testid="login-password"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            aria-pressed={showPwd}
            data-testid="login-password-toggle"
            className="absolute inset-y-0 right-0 inline-flex items-center gap-1 pr-2.5 text-11 text-muted-foreground transition-colors duration-200 hover:text-background-foreground"
          >
            {showPwd ? <EyeOff aria-hidden className="h-3.5 w-3.5" /> : <Eye aria-hidden className="h-3.5 w-3.5" />}
            {showPwd ? "隐藏" : "显示"}
          </button>
        </div>
      </div>

      <Button
        variant="primary"
        size="lg"
        data-testid="login-submit"
        disabled={submitting}
        onClick={async () => {
          setSubmitting(true);
          setLoginError(null);
          try {
            const out = await login(email, password);
            storeSessionToken(out.sessionToken);
            // 登录成功后进入「全部项目」——UC-1.1 R3 收口步骤。
            // ⚠ 落地页仍是 `/projects`（原型屏，mock 数据）：真实实现要由服务端决定
            //   落地页（有待办 → 任务；被邀请进某场进行中的项目 → 直接进那个项目），
            //   这不在本次 issue #355 范围内——本次只接通「登录本身」这一段。
            router.push("/projects");
          } catch (e) {
            setLoginError(
              e instanceof ApiError && e.reasonCode !== null
                ? "邮箱或密码不正确"
                : "登录服务暂时不可用，请稍后重试",
            );
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "正在进入…" : "登录"}
      </Button>
      {loginError !== null ? (
        <p data-testid="login-error" className="text-12 text-destructive">
          {loginError}
        </p>
      ) : null}

      {/* ── 分隔 · 第三方（D-02：保留视觉位但 disabled 标 later）───────── */}
      <div className="flex items-center gap-3 py-0.5">
        <Separator className="flex-1" />
        <span className="text-11 text-muted-foreground">或</span>
        <Separator className="flex-1" />
      </div>
      <div className="flex flex-col gap-2" data-testid="login-providers">
        <div className="grid grid-cols-3 gap-2">
          {AUTH_PROVIDERS_LATER.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              disabled
              data-testid={`login-provider-${p.id}`}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-11 text-muted-foreground">
          社交登录与企业 SSO <strong className="font-medium">phase-1 暂不开放</strong>（later）。
          本阶段正式成员仅走邮箱 + 密码。
        </p>
      </div>

      <p className="text-12 text-muted-foreground">
        还没有账号？{" "}
        <button
          type="button"
          onClick={() => setCreateOrg(true)}
          data-testid="login-create-org"
          className="font-medium text-primary underline-offset-4 transition-all duration-200 hover:underline"
        >
          创建组织 · 需要 14 位邀请码
        </button>
      </p>
    </div>
  );

  return (
    <StateShell
      state={state}
      className="flex flex-col gap-4"
      skeletonRows={4}
      emptyHint="这个环境还没有可登录的账号——请先用 14 位邀请码创建组织"
      errors={{ form: "邮箱或密码不正确" }}
      depFailure={{ what: "认证 / 邮件服务暂时不可用，已保留你填的邮箱，可安全重试" }}
      denial={{
        layer: "organization",
        reason: "该账号已被停用或已从组织移除，请联系组织管理员",
      }}
      successMessage="登录成功，正在进入「全部项目」…"
    >
      {form}
    </StateShell>
  );
}
