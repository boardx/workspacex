/**
 * #4789 —— spec 侧的出站邮件观察口（对应 `apps/api/scripts/loopback-mail-provider.ts`）。
 *
 * 端口环境变量名等常量的唯一事实源是 `../fullstack-smoke-fixture` 的 `MAIL_LOOPBACK`；
 * 本文件不写任何第二份字面量。
 *
 * 典型用法：
 *   const mail = await waitForMail({ to: email, subjectIncludes: "Verify" });
 *   const link = extractFirstLink(mail, "/auth/verify-email");
 *
 * 并行安全：`waitForMail` 按收件人过滤，spec 用各自唯一的邮箱即可；`setMailFault` 带 `to` 时
 * 只影响发往该地址的邮件，不会误伤并行 spec。
 */
import { MAIL_LOOPBACK } from "../fullstack-smoke-fixture";

export interface LoopbackMail {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly receivedAt: string;
  readonly headers: Record<string, string>;
}

export type MailFaultMode = "none" | "reject" | "timeout";

export interface MailLoopbackStats {
  readonly accepted: number;
  readonly rejected: number;
  readonly timedOut: number;
  readonly unauthorized: number;
  readonly fault: { readonly mode: MailFaultMode; readonly to: string | null };
}

function baseUrl(): string {
  const port = process.env[MAIL_LOOPBACK.portEnv];
  if (!port) {
    throw new Error(`${MAIL_LOOPBACK.portEnv} is required; run through the root isolation wrapper`);
  }
  return `http://127.0.0.1:${port}`;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`mail loopback ${method} ${path} -> ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function listMail(query: { to?: string; since?: string } = {}): Promise<LoopbackMail[]> {
  const params = new URLSearchParams();
  if (query.to) params.set("to", query.to);
  if (query.since) params.set("since", query.since);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return (await call<{ messages: LoopbackMail[] }>("GET", `/__messages${suffix}`)).messages;
}

/** 轮询直到出现**第一封**匹配邮件；超时抛错并带上该收件人当前已收到的主题，便于定位。 */
export async function waitForMail(input: {
  to: string;
  subjectIncludes?: string;
  since?: string;
  timeoutMs: number;
}): Promise<LoopbackMail> {
  const deadline = Date.now() + input.timeoutMs;
  let seen: LoopbackMail[] = [];
  for (;;) {
    seen = await listMail({ to: input.to, since: input.since });
    const hit = seen.find((m) => input.subjectIncludes === undefined || m.subject.includes(input.subjectIncludes));
    if (hit) return hit;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `no mail to ${input.to}${input.subjectIncludes ? ` with subject containing "${input.subjectIncludes}"` : ""} ` +
      `within ${input.timeoutMs}ms; subjects seen for this recipient: ${JSON.stringify(seen.map((m) => m.subject))}`,
  );
}

/**
 * 取正文（text 优先，再 html）里**第一个**路径以 `pathPrefix` 开头的 http(s) 链接。
 * 找不到抛错——「邮件里没有那个链接」是产品缺陷，不该被悄悄吞成 undefined。
 */
export function extractFirstLink(mail: Pick<LoopbackMail, "text" | "html">, pathPrefix: string): URL {
  for (const source of [mail.text, mail.html]) {
    for (const match of source.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
      // html 里属性值可能把 & 写成 &amp;
      const candidate = match[0].replace(/&amp;/g, "&");
      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        continue;
      }
      if (url.pathname.startsWith(pathPrefix)) return url;
    }
  }
  throw new Error(`no link with path prefix "${pathPrefix}" in mail; text=${JSON.stringify(mail.text)}`);
}

/** 清空已记录邮件与计数（不改 fault 设置）。 */
export async function resetMailbox(): Promise<void> {
  await call("DELETE", "/__messages");
}

/**
 * 切换**之后**发送的故障模式。`options.to` 把故障限定在某个收件人，强烈建议并行环境下总是带上；
 * 结束时务必 `setMailFault("none", { to })` 复位（用 try/finally）。
 */
export async function setMailFault(mode: MailFaultMode, options: { to?: string } = {}): Promise<void> {
  await call("POST", "/__fault", { mode, ...(options.to ? { to: options.to } : {}) });
}

export async function getMailStats(): Promise<MailLoopbackStats> {
  return call<MailLoopbackStats>("GET", "/__stats");
}
