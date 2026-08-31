/**
 * FB-2 —— "转开发"时真的往 `boardx/workspacex` 建一个 GitHub issue。
 *
 * 纯 `fetch`，**不装 `octokit`**：本仓从来没有过这个依赖，一个 classic PAT + 三个
 * 请求头（`Authorization` / `User-Agent` / `Accept`）就够表达"建一个 issue"，
 * 装一整个 SDK 换一次 REST 调用不成比例。同 `CloudflareEmailTransport` 的选择。
 *
 * ⚠ **不是** `packages/coord-projection/src/github-app.ts`——那是 GitHub App + JWT
 *   短时 installation token 的重量级流程，服务的是 Cloudflare Workers CI projection。
 *   这里只需要"以一个人类账号的名义建一个 issue"，classic PAT 天然就是这个形状，
 *   把 App 流程搬过来除了多出一堆用不到的密钥轮换代码，什么都换不来。
 *
 * 配置与 `cloudflare-email-transport.ts` 同一套纪律：
 *   · `githubIssueConfig(env)` 显式列出用到的 env key，生产缺 token 直接拒绝启动；
 *     非生产允许缺（一个可选子系统不该拖垮整个 API 的 DI 阶段——同
 *     `lazyCloudflareEmailConfig` 头注那次 2026-08-05 的教训）。
 *   · `lazyGithubIssueConfig` 用同一个 Proxy-deferred 手法，把校验推迟到第一次
 *     真正建 issue 的时候。
 */
import {
  GithubIssueCreationError,
  type CreatedGithubIssue,
  type GithubIssueCreator,
  type GithubIssueDraft,
} from "../../application/feedback/notification-ports";

export const GITHUB_ISSUE_CONFIG = Symbol("GithubIssueConfig");

export interface GithubIssueConfig {
  readonly token: string;
  /** 默认 `boardx`——按需求文档可配置,但不强制运维必须显式给出。 */
  readonly owner: string;
  /** 默认 `workspacex`。 */
  readonly repo: string;
  readonly requestTimeoutMs: number;
}

export function githubIssueConfig(env: NodeJS.ProcessEnv = process.env): GithubIssueConfig {
  const production = env.NODE_ENV === "production";
  const values = {
    token: env.GITHUB_ISSUE_TOKEN ?? "",
    owner: env.GITHUB_ISSUE_REPO_OWNER ?? "boardx",
    repo: env.GITHUB_ISSUE_REPO_NAME ?? "workspacex",
  };
  if (production && values.token.length === 0) {
    throw new Error("GitHub issue creation configuration is incomplete (GITHUB_ISSUE_TOKEN missing)");
  }
  return { ...values, requestTimeoutMs: 10_000 };
}

/**
 * 与 `lazyCloudflareEmailConfig` 同一个理由、同一个手法：这是一个**可选子系统**——
 * 没有任何一次部署要求"进程启动时就必须能建 GitHub issue"，只有真的点了"转开发"
 * 那一刻才需要。把校验放进 `useFactory` 直接调用 `githubIssueConfig()`，会让整个 API
 * 因为一个当次部署可能根本不会触发的功能缺配置而拒绝启动。
 */
export function lazyGithubIssueConfig(env: NodeJS.ProcessEnv = process.env): GithubIssueConfig {
  let resolved: GithubIssueConfig | null = null;
  const get = (): GithubIssueConfig => (resolved ??= githubIssueConfig(env));

  const KEYS = new Set<string | symbol>(["token", "owner", "repo", "requestTimeoutMs"]);
  return new Proxy({} as GithubIssueConfig, {
    get: (_t, prop) => (KEYS.has(prop) ? get()[prop as keyof GithubIssueConfig] : undefined),
    has: (_t, prop) => KEYS.has(prop),
    ownKeys: () => [...KEYS] as (string | symbol)[],
    getOwnPropertyDescriptor: (_t, prop) =>
      KEYS.has(prop)
        ? { configurable: true, enumerable: true, get: () => get()[prop as keyof GithubIssueConfig] }
        : undefined,
  });
}

interface GithubIssueApiResponse {
  readonly html_url?: unknown;
  readonly number?: unknown;
}

export class FetchGithubIssueCreator implements GithubIssueCreator {
  constructor(
    private readonly config: GithubIssueConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async create(draft: GithubIssueDraft): Promise<CreatedGithubIssue> {
    if (!this.config.token) throw new GithubIssueCreationError(null);

    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abort.abort();
        reject(new GithubIssueCreationError(null));
      }, this.config.requestTimeoutMs);
    });

    const operation = async (): Promise<CreatedGithubIssue> => {
      let response: Response;
      try {
        response = await this.request(
          `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/issues`,
          {
            method: "POST",
            signal: abort.signal,
            headers: {
              authorization: `Bearer ${this.config.token}`,
              // GitHub REST API 强制要求一个 User-Agent，没有的话直接 403。
              "user-agent": "workspacex-feedback-loop",
              accept: "application/vnd.github+json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              title: draft.title,
              body: draft.body,
              labels: [...draft.labels],
            }),
          },
        );
      } catch {
        throw new GithubIssueCreationError(null);
      }
      if (!response.ok) throw new GithubIssueCreationError(response.status);
      const body = (await response.json().catch(() => ({}))) as GithubIssueApiResponse;
      if (typeof body.html_url !== "string" || typeof body.number !== "number") {
        throw new GithubIssueCreationError(response.status);
      }
      return { url: body.html_url, number: body.number };
    };

    try {
      return await Promise.race([operation(), timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
