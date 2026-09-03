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
  /**
   * ⚠ **2026-09-03 人类明确决策的一部分**(见 `notification-ports.ts` 头注)：
   * 反馈附件图片**不**提交进 `main`——那会绕过整个 PR/CI/review 生命周期,而且本仓
   * 好几条部署流水线(如 `deploy-coord-gateway.yml`)监听 `push: branches: [main]`,
   * 直接写 `main` 意味着运行时持有能触发生产部署的写权限,这不是"图片要不要公开"
   * 那次决策讨论过的范围。所以图片改成写进一个**与 `main` 完全无关的专用分支**——
   * 默认 `feedback-attachments`,不在任何 workflow 的 `push` 分支过滤器里,不触发
   * CI/CD、不进 `main` 的提交历史。首次使用时惰性建一个**孤儿分支**(orphan,见
   * `ensureAttachmentsBranch`),不是从 `main` 分叉,不携带源码历史。
   */
  readonly attachmentsBranch: string;
}

export function githubIssueConfig(env: NodeJS.ProcessEnv = process.env): GithubIssueConfig {
  const production = env.NODE_ENV === "production";
  const values = {
    token: env.GITHUB_ISSUE_TOKEN ?? "",
    owner: env.GITHUB_ISSUE_REPO_OWNER ?? "boardx",
    repo: env.GITHUB_ISSUE_REPO_NAME ?? "workspacex",
    attachmentsBranch: env.GITHUB_ISSUE_ATTACHMENTS_BRANCH ?? "feedback-attachments",
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

  const KEYS = new Set<string | symbol>(["token", "owner", "repo", "requestTimeoutMs", "attachmentsBranch"]);
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

  private repoUrl(): string {
    return `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
  }

  private contentsUrl(path: string): string {
    // Contents API 的 path 段本身允许 `/`(目录分隔),只有各段内部的特殊字符需要转义——
    // 这里的 path 永远是我们自己拼的 `feedback-attachments/<attachmentId>.<ext>`
    // （见 `triage-feedback.ts`），不是用户可控输入，逐段 encode 足够,不需要处理 `..`
    // 之类的路径穿越(attachmentId 是我们自己生成的 hex id)。
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `${this.repoUrl()}/contents/${encodedPath}`;
  }

  /** Git Data API 三件套——只有建孤儿分支(`ensureAttachmentsBranch`)用得到。 */
  private refUrl(branch: string): string {
    // `heads/` 是路径前缀,不是要编码进 branch 名字的一部分——只 encode branch 本身,
    // 不能对整个 `heads/<branch>` 一起 `encodeURIComponent`(会把分隔的 `/` 也转义掉)。
    return `${this.repoUrl()}/git/ref/heads/${encodeURIComponent(branch)}`;
  }
  private refsUrl(): string {
    return `${this.repoUrl()}/git/refs`;
  }
  private treesUrl(): string {
    return `${this.repoUrl()}/git/trees`;
  }
  private commitsUrl(): string {
    return `${this.repoUrl()}/git/commits`;
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
   * ⚠ **不写 `main`**(独立 review 二轮抓到的真实问题,见 `GithubIssueConfig.attachmentsBranch`
   *   头注)：所有请求都带 `branch: this.config.attachmentsBranch`,先 `ensureAttachmentsBranch`
   *   确保这个与 `main` 无关的专用分支存在。
   *
   * ⚠ **幂等修复**(独立 review 一轮抓到的真实 bug):GitHub Contents API 的 `PUT`
   *   是"建或改"同一个动词,但**改一个已存在的文件时必须带上那个文件当前的
   *   blob `sha`**,不带就是"以为在创建新文件"，撞见已存在的路径会 422。"上传成功、
   *   随后 issue 创建失败、释放 claim、管理员重试"这条路径会两次调用同一个 `path`
   *   (同一个 attachmentId ⇒ 同一个文件名)，第二次若不带 `sha` 就会 422、被
   *   best-effort 吞掉，issue 建出来但没带图——不是"极端情况"，是这个功能唯一的
   *   重试路径必然触发的坑。所以先 `GET` 一次探测这个 path 在这个分支上是否已
   *   存在、取到它的 `sha` 再 `PUT`；`404`(真的不存在)是首次上传,不带 `sha`;
   *   探测本身失败(401/403/429/5xx/网络异常)**不猜、直接失败**(独立 review 二轮
   *   指出的修正:此前把"探测失败"与"确实不存在"混为一谈,会在探测失败时仍然
   *   发一个不带 `sha` 的 `PUT`,对已存在的文件必然 422、被 best-effort 吞掉、
   *   issue 建出来但没带图——这不是"少一次幂等保护"，是制造了一条必然复现的
   *   丢图路径,所以改成显式失败,交给上层 `withAttachmentImages` 的 best-effort
   *   处理跳过这一张,而不是自己在这里悄悄发一个大概率会 422 的请求)。
   */
  async uploadImage(input: GithubIssueImageUpload): Promise<UploadedGithubIssueImage> {
    if (!this.config.token) throw new GithubIssueApiError("uploadImage", null);
    return this.withTimeout(async (signal) => {
      await this.ensureAttachmentsBranch(signal);
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
            branch: this.config.attachmentsBranch,
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
   * 探测 `path` 在附件专用分支上是否已经存在,存在则返回它的 blob `sha`(重试时
   * `PUT` 必须带上这个才能改已存在的文件)；真的不存在(`404`)返回 `null`,首次
   * 上传不带 `sha`；探测本身失败(网络异常、非 404 的非 2xx)**直接抛错**,不当成
   * "不存在"——见 `uploadImage` 头注的修正说明。
   *
   * ⚠ **2026-09-03 review 二轮再指出的边界**:`200` 但响应体里没有合法字符串
   *   `sha` 是一个**无效响应**,不是"文件不存在"——文件明明存在(不然不会 200),
   *   只是这次没能读出它的 `sha`。此前把这种情况也 `return null`,会退化成"当作
   *   首次上传"发一个不带 `sha` 的 `PUT`,对已存在文件必然 422、被上层 best-effort
   *   吞掉,issue 建出来但没带图——跟"探测失败当成不存在"是同一类错误,只是
   *   触发条件从"请求失败"换成了"请求成功但响应形状不对"。两者现在同一处置:
   *   直接抛错,不猜。
   */
  private async existingContentSha(path: string, signal: AbortSignal): Promise<string | null> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.config.attachmentsBranch)}`;
    let response: Response;
    try {
      response = await this.request(url, { method: "GET", signal, headers: this.headers() });
    } catch {
      throw new GithubIssueApiError("uploadImage", null);
    }
    if (response.status === 404) return null; // 分支或文件确实还不存在,首次上传
    if (!response.ok) throw new GithubIssueApiError("uploadImage", response.status);
    const body = (await response.json().catch(() => ({}))) as { sha?: unknown };
    if (typeof body.sha !== "string") throw new GithubIssueApiError("uploadImage", response.status);
    return body.sha;
  }

  /**
   * 惰性确保 `config.attachmentsBranch` 这个与 `main` 无关的专用分支存在——只在
   * 进程内第一次真的建了这个分支之后不再重复探测(`branchEnsured`,进程重启会
   * 重新探测一次,代价是一次多余的 `GET`,不是正确性问题)。
   *
   * 分支不存在时建一个**孤儿分支**(orphan——空树、无父提交):不从 `main` 分叉,
   * 不携带任何源码历史，是"图片托管在 GitHub 自己的服务器"与"不碰 main、不碰
   * 源码历史"两条要求唯一同时成立的做法(直接 `git branch` 分叉 `main` 会把整个
   * 源码历史带进这个本该只装图片的分支)。
   *
   * ⚠ 建分支的三步(`git/trees` → `git/commits` → `git/refs`)不是原子的:两个并发
   *   请求都探测到分支不存在、都在建,后建的那个 `POST git/refs` 会收到 GitHub 的
   *   `422`(ref 已存在)——这里把 `422` 当成"别的请求已经建完了,我不需要再建"，
   *   不是错误,同 `claimGithubIssueCreation` 类似并发场景的既有处置精神(虽然
   *   这里没有真正的互斥锁,只是把 GitHub 自己的"ref 已存在"报错读成信号)。
   */
  private branchEnsured = false;

  private async ensureAttachmentsBranch(signal: AbortSignal): Promise<void> {
    if (this.branchEnsured) return;
    let refRes: Response;
    try {
      refRes = await this.request(this.refUrl(this.config.attachmentsBranch), {
        method: "GET",
        signal,
        headers: this.headers(),
      });
    } catch {
      throw new GithubIssueApiError("uploadImage", null);
    }
    if (refRes.ok) {
      this.branchEnsured = true;
      return;
    }
    if (refRes.status !== 404) throw new GithubIssueApiError("uploadImage", refRes.status);

    let treeRes: Response;
    try {
      treeRes = await this.request(this.treesUrl(), {
        method: "POST",
        signal,
        headers: this.headers(),
        body: JSON.stringify({ tree: [] }),
      });
    } catch {
      throw new GithubIssueApiError("uploadImage", null);
    }
    if (!treeRes.ok) throw new GithubIssueApiError("uploadImage", treeRes.status);
    const treeBody = (await treeRes.json().catch(() => ({}))) as { sha?: unknown };
    if (typeof treeBody.sha !== "string") throw new GithubIssueApiError("uploadImage", treeRes.status);

    let commitRes: Response;
    try {
      commitRes = await this.request(this.commitsUrl(), {
        method: "POST",
        signal,
        headers: this.headers(),
        body: JSON.stringify({
          message: "feedback-attachments: orphan branch init (no source history, holds feedback images only)",
          tree: treeBody.sha,
          parents: [],
        }),
      });
    } catch {
      throw new GithubIssueApiError("uploadImage", null);
    }
    if (!commitRes.ok) throw new GithubIssueApiError("uploadImage", commitRes.status);
    const commitBody = (await commitRes.json().catch(() => ({}))) as { sha?: unknown };
    if (typeof commitBody.sha !== "string") throw new GithubIssueApiError("uploadImage", commitRes.status);

    let createRefRes: Response;
    try {
      createRefRes = await this.request(this.refsUrl(), {
        method: "POST",
        signal,
        headers: this.headers(),
        body: JSON.stringify({ ref: `refs/heads/${this.config.attachmentsBranch}`, sha: commitBody.sha }),
      });
    } catch {
      throw new GithubIssueApiError("uploadImage", null);
    }
    if (createRefRes.ok) {
      this.branchEnsured = true;
      return;
    }
    // ⚠ **2026-09-03 review 二轮再指出的边界**:`422` 不是"ref 已存在"的唯一含义——
    //   GitHub 对 `POST git/refs` 的 422 同时覆盖"ref 已存在"(并发的另一个请求
    //   刚建完,读作信号)与真正的 validation failure(比如 sha 指向的对象不合法)。
    //   此前把所有 `422` 一律当成"已经建完了",分不清这两种;真出现 validation
    //   failure 时会悄悄放行,后续的探测/上传在一个其实不存在的分支上operate,
    //   表现成更下游、更难查的错误。现在改成:只在**重新 `GET` 确认这个 ref 真的
    //   存在**之后才当作"已经建完",409/422 但 ref 其实不存在时仍然报错,不再猜。
    if (createRefRes.status === 422) {
      let recheck: Response;
      try {
        recheck = await this.request(this.refUrl(this.config.attachmentsBranch), {
          method: "GET",
          signal,
          headers: this.headers(),
        });
      } catch {
        throw new GithubIssueApiError("uploadImage", null);
      }
      if (recheck.ok) {
        this.branchEnsured = true;
        return;
      }
    }
    throw new GithubIssueApiError("uploadImage", createRefRes.status);
  }
}
