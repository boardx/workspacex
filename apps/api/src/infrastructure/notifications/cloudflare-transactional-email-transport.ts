/**
 * 通用事务性邮件的 Cloudflare 适配器——`CloudflareEmailTransport`
 * （`infrastructure/auth/cloudflare-email-transport.ts`）的姊妹文件，**不是**它的替代。
 *
 * 见 `application/notifications/transactional-mail-ports.ts` 头注：验证邮件那个
 * transport 的主题/正文是硬编的，给不了反馈状态变更这种需要任意文案的场景一个
 * 干净的调用方式。这里重新实现一份**同一形状**的适配器（Proxy-deferred 配置、
 * 生产 fail-fast / 非生产 permissive、构造函数收 `(config, request = fetch)` 方便测试
 * 注入 fake），差别只在于它发的是调用方给定的任意 `subject`/`text`。
 *
 * ⚠ **复用哪些、不复用哪些是刻意的**：
 *   · `accountId` / `mailFrom` 复用已有的 `CLOUDFLARE_ACCOUNT_ID` / `MAIL_FROM`——
 *     它们是账号级配置（哪个 Cloudflare 账号、哪个发件地址),两套邮件功能没有
 *     理由分别配一遍,那只会制造"两个地方各改一次、有一次忘了改"的漂移。
 *   · **token 不复用**：`CLOUDFLARE_EMAIL_API_TOKEN` 是专门发给验证邮件用的最小权限
 *     token（ADR-104）。给它加一个"顺便也能发反馈通知"的隐含用途，会让"这个 token
 *     到底管什么"变成一件需要读两份代码才能回答的事。新增
 *     `CLOUDFLARE_TXN_EMAIL_API_TOKEN`，与验证邮件的 token 各自最小权限、各自可
 *     单独轮换/吊销。
 *
 * ⚠ **2026-09-02 人类裁决的例外**：devapp 当时只配了 `CLOUDFLARE_EMAIL_API_TOKEN`
 *   （验证邮件那个），没有单独配 `CLOUDFLARE_TXN_EMAIL_API_TOKEN`——后台「测试邮件」
 *   因此报 `MAIL_NOT_CONFIGURED`。人类明确同意：没有专属 token 时**退回**共用验证邮件
 *   的那个（同一个 Cloudflare 账号下，两者都是"发邮件"权限，不是跨账号/跨权限混用）。
 *   ⚠ 这是运维成本与"两个 token 各自最小权限"之间的权衡，不是撤销上面那条设计——
 *   专属 token 仍然是**优先**读取的那个，配了它就完全不touch这条回退；只有在专属
 *   token 从未配置过的部署上，才会一直吃这条回退,直到运维单独发一个 txn token。
 *   决策记录、权衡（轮换/吊销影响）、何时能撤掉这条回退，见 issue #2567——独立评审
 *   finding #6（2026-09-03）要求这条例外要有可回指的记录，不能只是代码注释里一句
 *   "人类同意了"。
 * 见 ADR-108。
 */
import { TransactionalMailError } from "../../application/notifications/transactional-mail-ports";
import type {
  TransactionalMailMessage,
  TransactionalMailResult,
  TransactionalMailTransport,
} from "../../application/notifications/transactional-mail-ports";
import { renderBrandEmailHtml } from "./email-branding";

export const TRANSACTIONAL_MAIL_CONFIG = Symbol("TransactionalMailConfig");

export interface TransactionalMailConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly mailFrom: string;
  readonly requestTimeoutMs: number;
}

export function transactionalMailConfig(env: NodeJS.ProcessEnv = process.env): TransactionalMailConfig {
  const production = env.NODE_ENV === "production";
  const values = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    // ⚠ 回退到 CLOUDFLARE_EMAIL_API_TOKEN——见上方"2026-09-02 人类裁决的例外"。
    apiToken: env.CLOUDFLARE_TXN_EMAIL_API_TOKEN ?? env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
    mailFrom: env.MAIL_FROM ?? "",
  };
  if (production && Object.values(values).some((value) => value.length === 0)) {
    throw new Error("Transactional email delivery configuration is incomplete");
  }
  return { ...values, requestTimeoutMs: 10_000 };
}

/** 同 `lazyCloudflareEmailConfig`：一个可选子系统的配置缺失,不该拖垮整个 API 启动。 */
export function lazyTransactionalMailConfig(
  env: NodeJS.ProcessEnv = process.env,
): TransactionalMailConfig {
  let resolved: TransactionalMailConfig | null = null;
  const get = (): TransactionalMailConfig => (resolved ??= transactionalMailConfig(env));

  const KEYS = new Set<string | symbol>(["accountId", "apiToken", "mailFrom", "requestTimeoutMs"]);
  return new Proxy({} as TransactionalMailConfig, {
    get: (_t, prop) => (KEYS.has(prop) ? get()[prop as keyof TransactionalMailConfig] : undefined),
    has: (_t, prop) => KEYS.has(prop),
    ownKeys: () => [...KEYS] as (string | symbol)[],
    getOwnPropertyDescriptor: (_t, prop) =>
      KEYS.has(prop)
        ? { configurable: true, enumerable: true, get: () => get()[prop as keyof TransactionalMailConfig] }
        : undefined,
  });
}

// 错误类挪到了端口层（调用方按类别映射契约码时只能依赖端口）；这里 re-export 保持既有 import 路径可用。
export { TransactionalMailError };

export class CloudflareTransactionalEmailTransport implements TransactionalMailTransport {
  constructor(
    private readonly config: TransactionalMailConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(message: TransactionalMailMessage): Promise<TransactionalMailResult> {
    if (!this.config.accountId || !this.config.apiToken || !this.config.mailFrom) {
      throw new TransactionalMailError("configuration_missing");
    }
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abort.abort();
        reject(new TransactionalMailError("timeout"));
      }, this.config.requestTimeoutMs);
    });
    const operation = async (): Promise<TransactionalMailResult> => {
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
              to: message.to,
              subject: message.subject,
              text: message.text,
              // ⚠ html 是这一层自动套的品牌外壳（见 email-branding.ts 头注），不是
              //   调用方给的——message 里仍然只有任意 subject/text，端口契约没变。
              html: renderBrandEmailHtml({ heading: message.subject, text: message.text }),
            }),
          },
        );
      } catch {
        throw new TransactionalMailError(abort.signal.aborted ? "timeout" : "network");
      }
      if (!response.ok) {
        throw new TransactionalMailError(`provider_http_${response.status}`);
      }
      const body = (await response.json().catch(() => ({}))) as { success?: boolean };
      if (body.success !== true) {
        throw new TransactionalMailError("provider_invalid_response");
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
