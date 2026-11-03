"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { CheckCircle2, CircleAlert, LoaderCircle, Mail } from "lucide-react";
import { auth as C } from "@repo/contracts";
import { apiRequest } from "@/lib/api-client";
import {
  bootstrapFirstUser,
  contractFieldIssues,
  isBootstrapUnavailable,
  isRegistrationEmailTaken,
  login,
} from "@/lib/auth";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/entry/auth-shell";

/**
 * open-self-serve-registration delta（issue #1929，design-signoff 已裁①②③④⑤）——
 * `/register` 的默认（也是唯一广告出来的）入口是自助开放注册：邮箱 + 密码 + 姓名 +
 * 组织名，直接建一个新组织并成为其 owner，不再需要邀请码。**这不是加一条路径，是把
 * `redeemInviteAndCreateOrg`（邀请码建组织）连同它的输入框一起移除**（design-signoff
 * ④「彻底移除，只留开放注册」逐字照录）。
 *
 * ⚠ 冷启动的“创建首位管理员”（`bootstrapFirstUser`，`POST /auth/bootstrap`）**不在**本次
 * 移除范围——它是一个独立、永久一次性的契约操作，与被移除的邀请码路径无关，本 delta
 * 明确不动它。但它在本文件之外没有任何其他 UI 入口（全仓唯一调用点搬迁自 #452），
 * 直接删掉会让"全新实例创建首位管理员"这条能力在界面上彻底消失——这是本 delta 没有
 * 授权的范围。于是它保留为一条**次要、需要显式切换**的入口（下面的“创建首位管理员”
 * 链接），而不再靠"邀请码留空"这个已经不存在的信号触发。
 *
 * 防滥用手段收敛为邮箱验证：未验证不能登录，复用既有闭环（`login.ts` 的
 * `EMAIL_NOT_VERIFIED` 检查直接读 `credentials.email_verified_at`，与哪条注册路径写入
 * 该行无关）。
 */
type RegisterInput = typeof C.operations.registerNewAccount.in._input;
type RegisterOutput = typeof C.operations.registerNewAccount.out._output;

/**
 * 字段级 400 的**如实**回显。
 *
 * ⚠ 这不是锦上添花：不做这一层，`ZodBodyPipe` 的校验失败（无 `reasonCode`）会掉进
 * 「创建服务暂时不可用」的兜底文案——把一个用户自己能改的输入错误伪装成不可抗力，
 * 用户没有任何线索去改，只会重试到放弃（2026-08-05 在 devapp 上真实发生过一次）。
 *
 * 只翻译**字段位置**，不回显用户提交的值（后端也从不回传值，见 all-exceptions.filter.ts）。
 */
type RegistrationFailure = { fields: readonly string[] } | { message: MessageKey };
const FIELD_LABEL: Record<string, MessageKey | undefined> = {
  "password": "account.register.fieldPassword", "email": "account.register.fieldEmail",
  "orgName": "account.register.fieldOrg", "displayName": "account.register.fieldName",
};
function fieldFailure(error: unknown): RegistrationFailure | null {
  const issues = contractFieldIssues(error);
  return issues ? { fields: issues.map((issue) => issue.path) } : null;
}
function registrationErrorText(error: RegistrationFailure, t: ReturnType<typeof useI18n>["t"]): string {
  if ("message" in error) return t(error.message);
  const labels = error.fields.map((field) => {
    const message = Object.hasOwn(FIELD_LABEL, field) ? FIELD_LABEL[field] : undefined;
    return message ? t(message, { min: C.AUTH_POLICY.passwordMinLen }) : t("account.register.fieldInvalid", { field });
  });
  return t("account.register.checkFields", { fields: [...new Set(labels)].join(t("account.register.fieldSeparator")) });
}

export function Registration() {
  const { t } = useI18n();
  const session = useSession();
  const [email, setEmail] = React.useState("");
  const [bootstrapMode, setBootstrapMode] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [formError, setFormError] = React.useState<RegistrationFailure | null>(null);
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
        const input: RegisterInput = registration;
        await apiRequest<RegisterOutput>(C.operations.registerNewAccount.path, {
          method: "POST", sessionToken: null, body: input,
        });
        setCooling(true);
        setQueued(true);
      } catch (e) {
        // 409 EMAIL_TAKEN 是**故意明确**的（引导用户去登录），不做模糊化——防枚举在
        // login / password-reset 上做，注册这条路径本来就没有邀请码搜索空间要保护。
        setFormError(fieldFailure(e) ?? {
          message: isRegistrationEmailTaken(e) ? "account.register.emailTaken" : "account.register.incomplete",
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── 冷启动分支：创建本实例的首位管理员（`bootstrapFirstUser`，与本 delta 无关，
    // 未被改动，仅仅是触发方式从「邀请码留空」换成显式切换）──
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
        setFormError({ message: "account.register.adminCreated" });
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
      setFormError(fieldFailure(e) ?? {
        message: isBootstrapUnavailable(e) ? "account.register.bootstrapUnavailable"
          : isRegistrationEmailTaken(e) ? "account.register.emailTaken" : "account.register.unavailable",
      });
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
      <AuthShell
        testId="registration-verification-queued"
        icon={<Mail className="h-6 w-6 text-primary" aria-hidden />}
        title={t("account.register.queuedTitle")}
        description={t("account.register.queuedDescription", { hours: C.AUTH_POLICY.verificationLinkHours }).split("{email}").map((part, index) => (
          <React.Fragment key={index}>{index > 0 ? <strong className="text-background-foreground">{email}</strong> : null}{part}</React.Fragment>
        ))}
        footer={<a href="/login" className="text-primary underline-offset-4 transition-colors duration-base hover:underline">{t("ui.backToSignIn")}</a>}
      >
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            data-testid="registration-verification-resend"
            disabled={resending || cooling}
            onClick={() => void resend()}
          >
            {resending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {resending ? t("account.register.resending") : cooling ? t("account.register.resendAfter", { seconds: C.AUTH_POLICY.resendCooldownSeconds }) : t("account.register.resend")}
          </Button>
          {cooling ? (
            <p role="status" className="flex items-center gap-1 text-12 text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {t("account.register.emailQueued")}
            </p>
          ) : null}
          {resendFailed ? (
            <p role="alert" className="flex items-center gap-1 text-12 text-destructive">
              <CircleAlert className="h-4 w-4" aria-hidden /> {t("account.register.resendFailed")}
            </p>
          ) : null}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={bootstrapMode ? t("account.register.bootstrapTitle") : t("account.register.orgTitle")}
      description={
        bootstrapMode
          ? t("account.register.bootstrapDescription")
          : t("account.register.description")
      }
      footer={
        <div className="flex flex-col gap-2">
          <p>
            {t("account.register.haveAccount")}{" "}
            <a href="/login" className="font-medium text-primary underline-offset-4 transition-colors duration-base hover:underline">{t("ui.backToSignIn")}</a>
          </p>
          <button
            type="button"
            data-testid="registration-bootstrap-toggle"
            className="self-start text-11 text-muted-foreground underline-offset-4 transition-colors duration-base hover:text-background-foreground hover:underline"
            onClick={() => setBootstrapMode((v) => !v)}
          >
            {bootstrapMode ? t("account.register.switchNormal") : t("account.register.switchBootstrap")}
          </button>
        </div>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field label={t("account.register.orgName")} name="orgName" required data-testid="registration-org-name" />
        <Field label={t("account.register.yourName")} name="displayName" required data-testid="registration-display-name" />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="registration-email">{t("ui.workEmail")}</Label>
          <Input id="registration-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required data-testid="registration-email" />
        </div>
        <Field label={t("account.register.passwordLabel", { min: C.AUTH_POLICY.passwordMinLen })} name="password" type="password" minLength={C.AUTH_POLICY.passwordMinLen} required data-testid="registration-password" />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={submitting}
          data-testid="registration-submit"
        >
          {submitting ? t("account.register.creating") : bootstrapMode ? t("account.register.bootstrapSubmit") : t("account.register.orgTitle")}
        </Button>
        {formError !== null ? <p role="alert" data-testid="registration-error" className="text-12 text-destructive">{registrationErrorText(formError, t)}</p> : null}
      </form>
    </AuthShell>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  const { label, name, ...input } = props;
  const id = `registration-${name}`;
  return <div className="flex flex-col gap-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} name={name} {...input} /></div>;
}
