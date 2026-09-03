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
  GithubIssueApiError,
  GithubIssueCreationError,
  type CreatedGithubIssue,
  type CreatedGithubIssueComment,
  type GithubIssueCreator,
  type GithubIssueDraft,
  type GithubIssueImageUpload,
  type GithubIssueImageUploader,
  type GithubIssueLinkedPullRequest,
  type GithubIssueStateTarget,
  type GithubIssueStatus,
  type UploadedGithubIssueImage,
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

interface GithubIssueGetResponse {
  readonly state?: unknown;
  readonly state_reason?: unknown;
}

/**
 * `GET .../timeline` 一条 `cross-referenced` 事件的形状——GitHub 官方文档没有把这个
 * 完整列出来，这里只挑我们用得到的字段。`source.issue` 之所以可能是一个 PR，是因为
 * GitHub 内部 PR 也是 issue 的一种；带 `pull_request` 子对象就说明它是 PR，不是
 * 另一个反过来提到本 issue 的 issue。
 */
interface GithubTimelineEventResponse {
  readonly event?: unknown;
  readonly source?: {
    readonly issue?: {
      readonly number?: unknown;
      readonly html_url?: unknown;
      readonly title?: unknown;
      readonly state?: unknown;
      readonly pull_request?: { readonly merged_at?: unknown } | null;
    };
  };
}

export class FetchGithubIssueCreator implements GithubIssueCreator, GithubIssueImageUploader {
  constructor(
    private readonly config: GithubIssueConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  private issuesUrl(): string {
    return `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/issues`;
  }

  private issueUrl(issueNumber: number): string {
    return `${this.issuesUrl()}/${issueNumber}`;
  }

  private contentsUrl(path: string): string {
    // Contents API 的 path 段本身允许 `/`(目录分隔),只有各段内部的特殊字符需要转义——
    // 这里的 path 永远是我们自己拼的 `feedback-attachments/<attachmentId>.<ext>`
    // （见 `triage-feedback.ts`），不是用户可控输入，逐段 encode 足够,不需要处理 `..`
    // 之类的路径穿越(attachmentId 是我们自己生成的 hex id)。
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/contents/${encodedPath}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.token}`,
      // GitHub REST API 强制要求一个 User-Agent，没有的话直接 403。
      "user-agent": "workspacex-feedback-loop",
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    };
  }

  /**
   * 四个方法共用的"发一个请求，超时就 abort"骨架——原本这段只在 `create` 里写过
   * 一次，现在四个方法都要，抽出来不是为了少打字，是为了这条**超时纪律只被
   * 实现一次**：以后要调超时时长/加重试，不会有第二处需要同步改。
   */
  private async withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, onTimeout: () => Error): Promise<T> {
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abort.abort();
        reject(onTimeout());
      }, this.config.requestTimeoutMs);
    });
    try {
      return await Promise.race([run(abort.signal), timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async create(draft: GithubIssueDraft): Promise<CreatedGithubIssue> {
    if (!this.config.token) throw new GithubIssueCreationError(null);
    return this.withTimeout(async (signal) => {
      let response: Response;
      try {
        response = await this.request(this.issuesUrl(), {
          method: "POST",
          signal,
          headers: this.headers(),
          body: JSON.stringify({ title: draft.title, body: draft.body, labels: [...draft.labels] }),
        });
      } catch {
        throw new GithubIssueCreationError(null);
      }
      if (!response.ok) throw new GithubIssueCreationError(response.status);
      const body = (await response.json().catch(() => ({}))) as GithubIssueApiResponse;
      if (typeof body.html_url !== "string" || typeof body.number !== "number") {
        throw new GithubIssueCreationError(response.status);
      }
      return { url: body.html_url, number: body.number };
    }, () => new GithubIssueCreationError(null));
  }

  /** best-effort 调用方（`triageFeedback`）——PATCH 同一个 `state` 是幂等的，重复调不是错误 */
  async setState(issueNumber: number, target: GithubIssueStateTarget): Promise<void> {
    if (!this.config.token) throw new GithubIssueApiError("setState", null);
    await this.withTimeout(async (signal) => {
      let response: Response;
      try {
        response = await this.request(this.issueUrl(issueNumber), {
          method: "PATCH",
          signal,
          headers: this.headers(),
          body: JSON.stringify(
            target.state === "open" ? { state: "open" } : { state: "closed", state_reason: target.stateReason },
          ),
        });
      } catch {
        throw new GithubIssueApiError("setState", null);
      }
      if (!response.ok) throw new GithubIssueApiError("setState", response.status);
    }, () => new GithubIssueApiError("setState", null));
  }

  /**
   * ⚠ issue 详情与 timeline 是**两次独立请求，availability 不共享**（2026-09-02
   * 独立审查 P1 指出的真实 bug）：之前用一个 `Promise.all` + 一个 try/catch 兜住
   * 两者，timeline 请求本身网络失败（不只是非 2xx）会连带整个 `getStatus` 失败，
   * 而 timeline 非 2xx 又被静默吞成"没有关联 PR"——前者是不该有的连坐，后者是把
   * "取不到"读成了"真的没有"这个假事实。现在两次请求**分开 try/catch**：issue
   * 详情失败 ⇒ 整个操作失败（它是这个方法的主要目的）；timeline 失败（网络异常
   * 或非 2xx）⇒ 只把 `linkedPullRequestsAvailable` 置 `false`，不影响 issue 状态
   * 那部分的返回。
   */
  async getStatus(issueNumber: number): Promise<GithubIssueStatus> {
    if (!this.config.token) throw new GithubIssueApiError("getStatus", null);
    return this.withTimeout(async (signal) => {
      let issueRes: Response;
      try {
        issueRes = await this.request(this.issueUrl(issueNumber), { method: "GET", signal, headers: this.headers() });
      } catch {
        throw new GithubIssueApiError("getStatus", null);
      }
      if (!issueRes.ok) throw new GithubIssueApiError("getStatus", issueRes.status);
      const issueBody = (await issueRes.json().catch(() => ({}))) as GithubIssueGetResponse;
      if (issueBody.state !== "open" && issueBody.state !== "closed") {
        throw new GithubIssueApiError("getStatus", issueRes.status);
      }
      const stateReason =
        issueBody.state_reason === "completed" || issueBody.state_reason === "not_planned"
          ? issueBody.state_reason
          : null;

      const { linkedPullRequests, available: linkedPullRequestsAvailable } =
        await this.fetchLinkedPullRequests(issueNumber, signal);

      return { state: issueBody.state, stateReason, linkedPullRequests, linkedPullRequestsAvailable };
    }, () => new GithubIssueApiError("getStatus", null));
  }

  /**
   * ⚠ 分页封顶在 100 条(`per_page=100`)、不翻页——独立审查同一条 P1 里点名的
   * 已知限制，这里如实登记而不是悄悄吞掉：一个 issue 被 100+ 个事件（含非
   * cross-referenced 的评论/标签变更等）引用是极端情况，真遇到时表现是"漏掉
   * 更早的引用"，不是"报错"或"假装没有"。要做严谨就需要翻页遍历
   * timeline，这里先不做（当前唯一使用方是人工在卡片上点开看一眼，不是需要
   * 完整性保证的审计场景），留作后续。
   */
  private async fetchLinkedPullRequests(
    issueNumber: number,
    signal: AbortSignal,
  ): Promise<{ readonly linkedPullRequests: GithubIssueLinkedPullRequest[]; readonly available: boolean }> {
    let timelineRes: Response;
    try {
      timelineRes = await this.request(`${this.issueUrl(issueNumber)}/timeline?per_page=100`, {
        method: "GET",
        signal,
        headers: this.headers(),
      });
    } catch {
      return { linkedPullRequests: [], available: false };
    }
    if (!timelineRes.ok) return { linkedPullRequests: [], available: false };

    const events = (await timelineRes.json().catch(() => null)) as readonly GithubTimelineEventResponse[] | null;
    if (events === null) return { linkedPullRequests: [], available: false };

    const linkedPullRequests: GithubIssueLinkedPullRequest[] = [];
    const seen = new Set<number>();
    for (const ev of events) {
      if (ev.event !== "cross-referenced") continue;
      const src = ev.source?.issue;
      if (!src || !src.pull_request) continue; // 只要 PR，不要另一个反过来引用它的 issue
      const { number, html_url: htmlUrl, title, state, pull_request: pr } = src;
      if (typeof number !== "number" || typeof htmlUrl !== "string" || typeof title !== "string") continue;
      if (seen.has(number)) continue;
      seen.add(number);
      const merged = typeof pr === "object" && pr !== null && typeof pr.merged_at === "string";
      const prState: GithubIssueLinkedPullRequest["state"] = merged ? "merged" : state === "closed" ? "closed" : "open";
      linkedPullRequests.push({ number, url: htmlUrl, title, state: prState });
    }
    return { linkedPullRequests, available: true };
  }

  async addComment(issueNumber: number, body: string): Promise<CreatedGithubIssueComment> {
    if (!this.config.token) throw new GithubIssueApiError("addComment", null);
    return this.withTimeout(async (signal) => {
      let response: Response;
      try {
        response = await this.request(`${this.issueUrl(issueNumber)}/comments`, {
          method: "POST",
          signal,
          headers: this.headers(),
          body: JSON.stringify({ body }),
        });
      } catch {
        throw new GithubIssueApiError("addComment", null);
      }
      if (!response.ok) throw new GithubIssueApiError("addComment", response.status);
      const parsed = (await response.json().catch(() => ({}))) as { html_url?: unknown };
      if (typeof parsed.html_url !== "string") throw new GithubIssueApiError("addComment", response.status);
      return { url: parsed.html_url };
    }, () => new GithubIssueApiError("addComment", null));
  }

  /**
   * `triageFeedback` 建 issue 之前,把反馈附件的图片字节推进仓库。返回的
   * `content.download_url` 就是 `raw.githubusercontent.com` 直链,GitHub 渲染 issue
   * 正文里的 `![](url)` 时匿名抓的就是这个地址,不需要 `Authorization` 头。
   *
   * ⚠ **幂等修复**(独立 review 抓到的真实 bug,见 `notification-ports.ts` 头注)：
   *   GitHub Contents API 的 `PUT` 是"建或改"同一个动词,但**改一个已存在的文件时
   *   必须带上那个文件当前的 blob `sha`**,不带就是"以为在创建新文件"，撞见已存在
   *   的路径会 422。"上传成功、随后 issue 创建失败、释放 claim、管理员重试"这条
   *   路径会两次调用同一个 `path`(同一个 attachmentId ⇒ 同一个文件名)，第二次若
   *   不带 `sha` 就会 422、被 best-effort 吞掉，issue 建出来但没带图——不是"极端情况"，
   *   是这个功能唯一的重试路径必然触发的坑。所以先 `GET` 一次探测这个 path 是否已
   *   存在、取到它的 `sha` 再 `PUT`；不存在(404)就是首次上传，不带 `sha`。
   */
  async uploadImage(input: GithubIssueImageUpload): Promise<UploadedGithubIssueImage> {
    if (!this.config.token) throw new GithubIssueApiError("uploadImage", null);
    return this.withTimeout(async (signal) => {
      const existingSha = await this.existingContentSha(input.path, signal);
      let response: Response;
      try {
        response = await this.request(this.contentsUrl(input.path), {
          method: "PUT",
          signal,
          headers: this.headers(),
          body: JSON.stringify({
            message: `feedback: attach ${input.path}`,
            content: Buffer.from(input.content).toString("base64"),
            ...(existingSha !== null ? { sha: existingSha } : {}),
          }),
        });
      } catch {
        throw new GithubIssueApiError("uploadImage", null);
      }
      if (!response.ok) throw new GithubIssueApiError("uploadImage", response.status);
      const body = (await response.json().catch(() => ({}))) as { content?: { download_url?: unknown } };
      const downloadUrl = body.content?.download_url;
      if (typeof downloadUrl !== "string") throw new GithubIssueApiError("uploadImage", response.status);
      return { url: downloadUrl };
    }, () => new GithubIssueApiError("uploadImage", null));
  }

  /**
   * 探测 `path` 当前是否已经存在于仓库,存在则返回它的 blob `sha`(重试时 `PUT`
   * 必须带上这个才能改已存在的文件),不存在(404)或探测本身失败一律返回 `null`——
   * 后者退化成"当成首次上传"，真撞见已存在文件时上面那次 `PUT` 会带着错误信息
   * 422,不会悄悄覆盖或丢数据，只是把"探测失败"降级成"少一次幂等保护"而不是
   * 直接让 `uploadImage` 整体失败(探测本身不是这个方法的主要目的)。
   */
  private async existingContentSha(path: string, signal: AbortSignal): Promise<string | null> {
    let response: Response;
    try {
      response = await this.request(this.contentsUrl(path), { method: "GET", signal, headers: this.headers() });
    } catch {
      return null;
    }
    if (!response.ok) return null; // 404 = 还没有这个文件,首次上传
    const body = (await response.json().catch(() => ({}))) as { sha?: unknown };
    return typeof body.sha === "string" ? body.sha : null;
  }
}
