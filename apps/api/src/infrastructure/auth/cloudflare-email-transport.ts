import type { VerificationMailTransport } from "../../application/auth/email-verification-ports";

export interface CloudflareEmailConfig {
  accountId: string;
  apiToken: string;
  mailFrom: string;
  appPublicUrl: string;
  previewEnabled: false;
  workerEnabled: boolean;
}

export function cloudflareEmailConfig(env: NodeJS.ProcessEnv = process.env): CloudflareEmailConfig {
  const production = env.NODE_ENV === "production";
  const previewEnabled = env.CLOUDFLARE_EMAIL_PREVIEW === "true";
  const values = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
    mailFrom: env.MAIL_FROM ?? "",
    appPublicUrl: env.APP_PUBLIC_URL ?? (production ? "" : "http://localhost:3000"),
  };
  if (production && previewEnabled) {
    throw new Error("Cloudflare Email Preview must be disabled in production");
  }
  if (production && Object.values(values).some((value) => value.length === 0)) {
    throw new Error("Cloudflare email delivery configuration is incomplete");
  }
  return { ...values, previewEnabled: false, workerEnabled: production || env.MAIL_OUTBOX_WORKER_ENABLED === "1" };
}

export class MailTransportError extends Error {
  constructor(readonly category: string, readonly retryable: boolean) {
    super(category);
    this.name = "MailTransportError";
  }
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
    let response: Response;
    try {
      response = await this.request(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/email/sending/send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: { address: this.config.mailFrom },
            to: input.to,
            subject: "Verify your WorkspaceX email",
            text: `Verify your email: ${input.verificationUrl}`,
            headers: {
              "Message-ID": `<${input.outboxId}@workspacex.invalid>`,
              "X-WorkspaceX-Outbox-ID": input.outboxId,
            },
          }),
        },
      );
    } catch {
      throw new MailTransportError("network", true);
    }
    if (!response.ok) {
      throw new MailTransportError(`provider_http_${response.status}`, response.status === 429 || response.status >= 500);
    }
    const body = await response.json().catch(() => ({})) as {
      result?: { delivered?: string[]; permanent_bounces?: string[]; queued?: string[] };
    };
    if (body.result?.permanent_bounces?.includes(input.to)) {
      throw new MailTransportError("provider_permanent_bounce", false);
    }
    if (!body.result?.delivered?.includes(input.to) && !body.result?.queued?.includes(input.to)) {
      throw new MailTransportError("provider_invalid_response", true);
    }
    return { providerMessageId: `<${input.outboxId}@workspacex.invalid>` };
  }
}
