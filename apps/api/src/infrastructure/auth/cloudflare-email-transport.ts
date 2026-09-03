import type { VerificationMailTransport } from "../../application/auth/email-verification-ports";
import { assertMailFromOnSendingDomain } from "../cloudflare-email-sending-domain";
import { renderBrandEmailHtml } from "../notifications/email-branding";

export interface CloudflareEmailConfig {
  accountId: string;
  apiToken: string;
  mailFrom: string;
  appPublicUrl: string;
  previewDisabledAttested: boolean;
  workerEnabled: boolean;
  requestTimeoutMs: number;
}

export function cloudflareEmailConfig(env: NodeJS.ProcessEnv = process.env): CloudflareEmailConfig {
  const production = env.NODE_ENV === "production";
  const previewDisabledAttested = env.CLOUDFLARE_EMAIL_PREVIEW_DISABLED === "true";
  const emailApiToken = env.CLOUDFLARE_EMAIL_API_TOKEN ?? "";
  const migrationApiToken = production ? "" : (env.CLOUDFLARE_API_TOKEN ?? "");
  const values = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: emailApiToken.length > 0 ? emailApiToken : migrationApiToken,
    mailFrom: env.MAIL_FROM ?? "",
    appPublicUrl: env.APP_PUBLIC_URL ?? (production ? "" : "http://localhost:3000"),
  };
  if (production && Object.values(values).some((value) => value.length === 0)) {
    throw new Error("Cloudflare email delivery configuration is incomplete");
  }
  if (production && (env.CLOUDFLARE_EMAIL_PREVIEW === "true" || !previewDisabledAttested)) {
    throw new Error("Cloudflare Email Preview disabled attestation is required in production");
  }
  if (production && !values.appPublicUrl.startsWith("https://")) {
    throw new Error("APP_PUBLIC_URL must use HTTPS in production");
  }
  if (production) {
    assertMailFromOnSendingDomain(values.mailFrom, env);
  }
  return {
    ...values,
    previewDisabledAttested,
    workerEnabled: production || env.MAIL_OUTBOX_WORKER_ENABLED === "1",
    requestTimeoutMs: 10_000,
  };
}

/**
 * 与 `cloudflareEmailConfig` 同一套校验，但**推迟到第一次真正用到配置时才跑**。
 *
 * ## 为什么需要它
 *
 * `cloudflareEmailConfig()` 在生产模式下缺任何一项就抛。它被直接用作 Nest 的
 * provider 工厂（`kernel.module.ts:641`），于是**整个 API 在 DI 阶段就起不来** ——
 * 哪怕这次部署根本不发一封信。
 *
 * 2026-08-05 实测的后果：核心闭环第 1 步走的是 bootstrap（`emailVerifiedAt`
 * 直接置位，**不发邮件**），而 API 因为一个用不到的子系统没配好而拒绝启动；
 * 运行时门控 G7 也因此红了一整轮，报出来只有一句 `child exited with 1`。
 *
 * ⇒ **校验本身没错，错的是它发生的时刻。** 一个可选子系统的配置缺失，
 *   应该在「有人真要发信」时炸，而不是在「进程要不要活着」时炸。
 *
 * ## 为什么用 Proxy 而不是把所有消费者改成收一个 thunk
 *
 * 消费者拿到的仍然是 `CloudflareEmailConfig`，类型与既有代码完全一致 ——
 * 改签名会波及 transport、outbox worker 与它们的测试，而那些测试断言的是
 * **投递语义**，不该为了一次启动时机的调整被搅动。
 *
 * ⚠ 校验**一次都没被削弱**：`cloudflareEmailConfig` 原样保留并继续抛，
 *   `email-verification-public.test.ts:592` 那三条「生产缺配置必须抛」照旧绿。
 *   变的只是「什么时候问它」。
 */
export function lazyCloudflareEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
): CloudflareEmailConfig {
  let resolved: CloudflareEmailConfig | null = null;
  const get = (): CloudflareEmailConfig => (resolved ??= cloudflareEmailConfig(env));

  /**
   * ⚠ 只有**真正的配置键**才触发解析。
   *
   * Nest 在 DI 期间会探测注入值的属性（`then`、`constructor`、各种 symbol ——
   * 实测栈顶就是 `Injector.instantiateClass`）。一个「读什么都解析」的 Proxy
   * 会被这些探测**当场引爆**，于是「延后到用时」根本没延后 ——
   * 第一版就是这么写的，症状与改之前一模一样：进程照旧起不来。
   *
   * ⇒ 键名集合写死。多一个字段就得在这里加一行 —— 这是刻意的：
   *   它让「谁在读这份配置」保持可见，而不是靠一个包罗万象的拦截器蒙混过去。
   */
  const KEYS = new Set<string | symbol>([
    "accountId", "apiToken", "mailFrom", "appPublicUrl",
    "previewDisabledAttested", "workerEnabled", "requestTimeoutMs",
  ]);
  return new Proxy({} as CloudflareEmailConfig, {
    get: (_t, prop) =>
      KEYS.has(prop) ? get()[prop as keyof CloudflareEmailConfig] : undefined,
    has: (_t, prop) => KEYS.has(prop),
    ownKeys: () => [...KEYS] as (string | symbol)[],
    getOwnPropertyDescriptor: (_t, prop) =>
      KEYS.has(prop)
        ? { configurable: true, enumerable: true, get: () => get()[prop as keyof CloudflareEmailConfig] }
        : undefined,
  });
}

export class MailTransportError extends Error {
  constructor(readonly category: string, readonly retryable: boolean) {
    super(category);
    this.name = "MailTransportError";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export class CloudflareEmailTransport implements VerificationMailTransport {
  constructor(
    private readonly config: CloudflareEmailConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async deliver(input: { outboxId: string; to: string; verificationUrl: string }) {
    if (!this.config.accountId || !this.config.apiToken || !this.config.mailFrom) {
      throw new MailTransportError("configuration_missing", false);
    }
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abort.abort();
        reject(new MailTransportError("timeout", true));
      }, this.config.requestTimeoutMs);
    });
    const operation = async () => {
      let response: Response;
      try {
        response = await this.request(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/email/sending/send`,
          {
            method: "POST",
            signal: abort.signal,
            headers: {
              authorization: `Bearer ${this.config.apiToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              from: { address: this.config.mailFrom },
              to: input.to,
              subject: "Verify your WorkspaceX email",
              text: `Verify your email: ${input.verificationUrl}`,
              // ⚠ 品牌外壳同 CloudflareTransactionalEmailTransport（见 email-branding.ts
              //   头注）；text 字段原样保留，作为不支持 HTML 的客户端 fallback。
              html: renderBrandEmailHtml({
                heading: "验证你的 WorkspaceX 邮箱",
                text: "点击下方按钮完成邮箱验证。如果这不是你本人的操作，忽略这封邮件即可。",
                cta: { label: "验证邮箱", url: input.verificationUrl },
              }),
              headers: { "X-WorkspaceX-Outbox-ID": input.outboxId },
            }),
          },
        );
      } catch {
        throw new MailTransportError(abort.signal.aborted ? "timeout" : "network", true);
      }
      if (!response.ok) {
        throw new MailTransportError(`provider_http_${response.status}`, response.status === 429 || response.status >= 500);
      }
      const body = await response.json().catch(() => ({})) as {
        success?: boolean;
        result?: {
          delivered?: string[];
          permanent_bounces?: string[];
          queued?: string[];
        };
      };
      if (body.success !== true || !body.result || !isStringArray(body.result.permanent_bounces)) {
        throw new MailTransportError("provider_invalid_response", true);
      }
      if (body.result.permanent_bounces.includes(input.to)) {
        throw new MailTransportError("provider_permanent_bounce", false);
      }
      if (!isStringArray(body.result.delivered) || !isStringArray(body.result.queued)) {
        throw new MailTransportError("provider_invalid_response", true);
      }
      const matchingOutcomes = [...body.result.delivered, ...body.result.queued]
        .filter((recipient) => recipient === input.to).length;
      if (matchingOutcomes !== 1) {
        throw new MailTransportError("provider_invalid_response", true);
      }
      return {};
    };
    try {
      return await Promise.race([operation(), timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
