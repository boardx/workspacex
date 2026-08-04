import type { VerificationMailTransport } from "../../application/auth/email-verification-ports";

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
  return {
    ...values,
    previewDisabledAttested,
    workerEnabled: production || env.MAIL_OUTBOX_WORKER_ENABLED === "1",
    requestTimeoutMs: 10_000,
  };
}

export class MailTransportError extends Error {
  constructor(readonly category: string, readonly retryable: boolean) {
    super(category);
    this.name = "MailTransportError";
  }
}

function isValidProviderMessageId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 998
    && value.trim() === value
    && !/[\r\n\0]/u.test(value);
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
          message_id?: string;
          permanent_bounces?: string[];
          queued?: string[];
        };
      };
      if (body.result?.permanent_bounces?.includes(input.to)) {
        throw new MailTransportError("provider_permanent_bounce", false);
      }
      if (body.success !== true || !isValidProviderMessageId(body.result?.message_id)) {
        throw new MailTransportError("provider_invalid_response", true);
      }
      return { providerMessageId: body.result.message_id };
    };
    try {
      return await Promise.race([operation(), timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
