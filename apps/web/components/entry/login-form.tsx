"use client";
import * as React from "react";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AUTH_PROVIDERS_LATER, AUTH_POLICY, LOGIN_BRAND } from "@/lib/mock/entry";
import {
  isLoginRejected,
  login,
  requestPasswordReset,
} from "@/lib/auth";
import { useSession } from "@/components/session/session-provider";

/**
 * 登录表单（UC-1.1 R3/R8）——七态一律经 StateShell。
 *
 * - D-02：三个第三方按钮**保留视觉位但 disabled 并标 later**，旁注「phase-1 暂不开放」。
 * - 防枚举：校验失败只给一条「邮箱或密码不正确」，不区分邮箱不存在 / 密码错误。
 * - `[忘记密码？]`（R8「原型待补」：按钮在、点了没屏）在此补出接线与后续屏。
 * - `[创建组织]` 进入真实 `/auth/register-open`（开放自助注册，issue #1929 起不再需要
 *   邀请码）注册与邮箱验证排队流程。
 * - #547：底部按**新用户身份**分岔成两条——开新组织走 `[创建组织]`；被已有组织邀请的人
 *   走管理员发出的激活链接（UC-1.6 / F10，`POST /org-invites/activate`）。后者是**说明**
 *   而不是入口，因为产品里并不存在「在登录页自助加入某组织」这条路径，见下方就地注释。
 */

/**
 * 找回密码请求发不出去时的**唯一**文案。抽成常量不是为了复用，是为了让
 * "再加一条别的文案"这个动作在代码里显眼——多一条按邮箱变化的文案，
 * 就等于把枚举信道从界面这一侧重新开出来。
 */
const RESET_RETRY_COPY = "重置服务暂时不可用，请稍后重试";

export function LoginForm({ state }: { state: UiState }) {
  const session = useSession();
  const [showPwd, setShowPwd] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [email, setEmail] = React.useState(state === "invalid" ? LOGIN_BRAND.sampleEmail : "");
  const [password, setPassword] = React.useState(state === "invalid" ? "••••••••" : "");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [forgot, setForgot] = React.useState(false);
  const [resetSent, setResetSent] = React.useState(false);
  const [resetEmail, setResetEmail] = React.useState("");
  const [resetSubmitting, setResetSubmitting] = React.useState(false);
  /**
   * ⚠ 刻意是 `boolean` 而不是 `string | null`。存文案的字段迟早会被塞进
   * 按响应变化的文案，而**能变化的文案就是信道**。后端对存在与不存在的邮箱
   * 返回同一个 200，所以任何 reject 都只可能是传输层问题、与"这个邮箱是谁"无关；
   * 一个布尔位配一条固定文案，既诚实又没有分叉的位置。
   */
  const [resetFailed, setResetFailed] = React.useState(false);
  if (forgot) {
    return (
      <div className="flex flex-col gap-4" data-testid="login-forgot-panel">
        <button
          type="button"
          onClick={() => {
            setForgot(false);
            setResetSent(false);
            setResetFailed(false);
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
                value={resetEmail}
                onChange={(e) => setResetEmail(e.currentTarget.value)}
                data-testid="login-forgot-email"
              />
            </div>
            <Button
              variant="primary"
              size="lg"
              disabled={resetSubmitting}
              onClick={async () => {
                setResetSubmitting(true);
                setResetFailed(false);
                try {
                  await requestPasswordReset(resetEmail);
                  // ⚠ 这里**没有** `if (out.sent)` 之类的判断，也不该有：
                  // 契约的 out 是 `{ sent: literal(true) }`，唯一的成功形状。
                  // 只要请求 resolve 了就进同一个已发送态，无论邮箱是否注册。
                  setResetSent(true);
                } catch {
                  // 不看 error 的 status / reasonCode——看了就有分叉的机会。
                  setResetFailed(true);
                } finally {
                  setResetSubmitting(false);
                }
              }}
              data-testid="login-forgot-submit"
            >
              {resetSubmitting ? "正在发送…" : "发送重置链接"}
            </Button>
            {resetFailed ? (
              <p data-testid="login-forgot-error" className="text-12 text-destructive">
                {RESET_RETRY_COPY}
              </p>
            ) : null}
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
            await session.startSession(out);
            // 登录成功后进入「全部项目」——UC-1.1 R3 收口步骤。
            // Use a document navigation after the session's atomic localStorage commit.
            // It prevents a stale RSC prefetch from racing the new bearer/current-org pair.
            window.location.assign("/projects");
          } catch (e) {
            setLoginError(
              isLoginRejected(e)
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

      {/*
        #547：两类新用户，之前只有第一类有入口。
        第二类给的是一句说明而不是按钮，因为受邀人的真实入场点是管理员发出的
        一次性激活链接（`POST /org-invites/activate`，见 org-invite.controller.ts），
        登录页这一侧没有、也不应该有一条「自助加入某组织」的路径——
        造一个可点按钮就等于发明一条不存在的注册流程。
        ⚠ 刻意不写「7 天」：链接时效的事实源在 `ORG_INVITE_LINK_VALIDITY_MS`，
        这里再抄一份就是第三处副本（mock/org-admin.ts 的 linkValidDays 已是第二处）。
      */}
      <div className="flex flex-col gap-1.5" data-testid="login-signup-paths">
        <p className="text-12 text-muted-foreground">还没有账号？看你属于哪一种：</p>
        <p className="text-12 text-muted-foreground">
          · 我要<strong className="font-medium">开一个新组织</strong>（首位管理员）{" "}
          <button
            type="button"
            onClick={() => window.location.assign("/auth/register")}
            data-testid="login-create-org"
            className="font-medium text-primary underline-offset-4 transition-all duration-200 hover:underline"
          >
            创建组织
          </button>
        </p>
        <p className="text-12 text-muted-foreground" data-testid="login-invited-hint">
          · 我<strong className="font-medium">被邀请加入已有组织</strong>：请直接打开管理员发给你的
          <strong className="font-medium">激活链接</strong>
          ，在那里设置密码即可入场；本页不需要、也无法自行注册加入某个组织。
          没收到链接或链接已失效，请联系该组织的管理员重发。
        </p>
      </div>
    </div>
  );

  return (
    <StateShell
      state={state}
      className="flex flex-col gap-4"
      skeletonRows={4}
      emptyHint="这个环境还没有账号——可直接创建首位管理员，无需邀请码"
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
