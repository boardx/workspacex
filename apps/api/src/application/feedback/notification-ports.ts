/**
 * FB-2 —— "转开发"建 GitHub issue、任意转移发状态变更邮件，这两条副作用
 * 用到的端口。与 `ports.ts` 分开放，是因为那份文件管的是**反馈本身的存取**
 * （仓储），而这份管的是**分诊触发的两个外部系统调用**——形状不同、生命周期
 * 也不同（仓储绑租户，这两个不绑）。
 */
import { feedbackLoop } from "@repo/contracts";
import type { z } from "zod";

/** 管理员在"转开发"弹层里编辑完之后提交的 GitHub issue 最终文案。 */
export interface GithubIssueDraft {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

export interface CreatedGithubIssue {
  readonly url: string;
  readonly number: number;
}

/** `setState` 的目标——GitHub 只接受这三种组合，`close` 必须带 `state_reason`。 */
export type GithubIssueStateTarget =
  | { readonly state: "open" }
  | { readonly state: "closed"; readonly stateReason: "completed" | "not_planned" };

/**
 * `getStatus` 查出来的"引用过这个 issue 的 PR"。**从契约派生**（ADR-020）——
 * 见契约 `GithubIssueLinkedPullRequest` 头注："引用过"不等于"关闭它的那一个"。
 */
export type GithubIssueLinkedPullRequest = z.infer<typeof feedbackLoop.GithubIssueLinkedPullRequest>;

export interface GithubIssueStatus {
  readonly state: "open" | "closed";
  readonly stateReason: "completed" | "not_planned" | null;
  /**
   * ⚠ 只在 `linkedPullRequestsAvailable === true` 时才是"这条 issue 真的没有 PR
   * 引用它"——见契约 `getFeedbackGithubIssue` 头注最后一条：issue 详情与 timeline
   * 是两次独立请求，timeline 单独失败时这里是空数组但 `linkedPullRequestsAvailable`
   * 是 `false`，调用方必须先看那个布尔。
   */
  readonly linkedPullRequests: readonly GithubIssueLinkedPullRequest[];
  readonly linkedPullRequestsAvailable: boolean;
}

export interface CreatedGithubIssueComment {
  readonly url: string;
}

/**
 * 建一个 GitHub issue，以及"转开发"之后管理员在后台反馈屏上会用到的三个操作：
 * 跟着分诊状态同步开关、现查状态与关联 PR、发一条评论。
 *
 * ⚠ **不是** `packages/coord-projection/src/github-app.ts` 那一套——那是 GitHub App
 *   + JWT，服务的是 Cloudflare Workers CI projection 那种需要装 App、需要短时安装
 *   token 的场景。这里只是"拿一个 classic PAT 操作一个 issue"，用那一套完全是杀鸡用
 *   牛刀，还会把两个毫不相关的子系统绑在一起——牛刀本身也换不了刀刃的形状：
 *   这四个操作都不需要"以某个 installation 的名义"，只需要一个有 `repo` 权限的 token。
 *
 * ⚠ **没有第五个方法去"列出所有反馈对应的 issue"**——查状态是**按这一条反馈**现查的
 *   （见 `getFeedbackGithubIssue` 契约头注：不落库、不批量），不是一个可以拿来做
 *   仪表盘的批量端点。真要做批量视图，那是另一条需要设计分页/限流的路，不是给这个
 *   接口顺手加一个 list。
 */
export interface GithubIssueCreator {
  create(draft: GithubIssueDraft): Promise<CreatedGithubIssue>;
  /** best-effort 调用方（`triageFeedback`）不关心失败原因，只 catch 后记日志 */
  setState(issueNumber: number, target: GithubIssueStateTarget): Promise<void>;
  getStatus(issueNumber: number): Promise<GithubIssueStatus>;
  addComment(issueNumber: number, body: string): Promise<CreatedGithubIssueComment>;
}

export const GITHUB_ISSUE_CREATOR = Symbol("GithubIssueCreator");

/**
 * 把一张反馈附件的图片字节推给 GitHub、换回一个 GitHub 匿名可读的 URL,供
 * `triageFeedback` 拼进 issue 正文的 `![](url)`——**不是** `GithubIssueCreator.create`
 * 能顺手做到的事:反馈附件的下载路由要 `Authorization` 头(见 `attachment-ports.ts`
 * 头注),GitHub 服务端渲染 issue 正文时是**匿名**抓图,那个内部 URL 它根本抓不到。
 * 用 Contents API 把图片提交进仓库,换回的 `download_url`(`raw.githubusercontent.com`）
 * 才是 GitHub 渲染器真正抓得到的地址。
 *
 * ⚠ **2026-09-03 人类明确决策**:独立 review 曾以"反馈附件受 D3 权限判定保护、
 *   `boardx/workspacex` 是公开仓库,提交进去等于永久绕开这道权限门"为由拦下这条
 *   实现(见 PR #2570 review 记录)。人类审视过这条权衡后明确要求"图片要真的显示
 *   在 issue 里,上传到 GitHub 自己的服务器,不要另建一套托管文件服务"——即接受
 *   "反馈截图会随分诊动作进入公开仓库、对任何人可见、且不可撤回"这个已知代价,
 *   换来"不需要为此单独建一套对象存储+预签名 URL 的托管基础设施"。这不是遗漏,
 *   是记录在案的、人类知情后的选择:后续如果要收紧(比如切到私有仓库或短时预签名
 *   URL),需要另一次人类决策,不是这里能单方面改回去的。
 *
 * ⚠ 与 `GithubIssueCreator` 分成两个接口而不是塞成 `create` 的第五个方法:
 *   `create` 的调用方(`triageFeedback`)已有的四个方法全部围绕"一个已存在的
 *   issue"展开,这个方法**不需要 issue 已经存在**(建 issue 之前就要先把图传完、
 *   把 URL 拼进 body),混进同一个接口会让"这个方法到底需不需要 issueNumber"
 *   这件事从类型上看不出来。两个接口共用同一个 `FetchGithubIssueCreator` 实现
 *   （同一个 token、同一份 PAT/仓库配置),DI 用 `useExisting` 把两个 token 指向
 *   同一个实例,不是重复造两套配置。
 */
export interface GithubIssueImageUpload {
  /** 仓库内的相对路径,如 `feedback-attachments/fbattach-xxx.png`。 */
  readonly path: string;
  readonly content: Uint8Array;
  readonly contentType: "image/png" | "image/jpeg" | "image/webp";
}

export interface UploadedGithubIssueImage {
  /** `raw.githubusercontent.com` 直链——GitHub 渲染 issue 正文时能匿名抓到的地址。 */
  readonly url: string;
}

export interface GithubIssueImageUploader {
  uploadImage(input: GithubIssueImageUpload): Promise<UploadedGithubIssueImage>;
}

export const GITHUB_ISSUE_IMAGE_UPLOADER = Symbol("GithubIssueImageUploader");

export class GithubIssueCreationError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "github issue creation failed" : `github issue creation failed (http ${status})`);
    this.name = "GithubIssueCreationError";
  }
}

/**
 * `setState` / `getStatus` / `addComment` / `uploadImage` 共用的失败信号。**不是**
 * `GithubIssueCreationError` 的别名——那个类名字面意思就是"建 issue 失败"，
 * `triageFeedback` 里仍然用它做 `instanceof` 判断来决定要不要 fail closed；这四个
 * 操作的调用方（best-effort 的状态同步、`get-feedback-github-issue.ts` /
 * `comment-on-feedback-github-issue.ts` 两个用例、以及建 issue 前 best-effort 上传
 * 附件图片那一步）要的是一个通用的"这次打 GitHub API 没成功"，用同一个类会让
 * `triageFeedback` 的 `instanceof GithubIssueCreationError` 误吞不该吞的错误类型。
 */
export class GithubIssueApiError extends Error {
  constructor(readonly op: "setState" | "getStatus" | "addComment" | "uploadImage", readonly status: number | null) {
    super(status === null ? `github issue ${op} failed` : `github issue ${op} failed (http ${status})`);
    this.name = "GithubIssueApiError";
  }
}

/**
 * 查状态 / 发评论时，这条反馈还没有关联的 GitHub issue。两个用例
 * （`get-feedback-github-issue.ts` / `comment-on-feedback-github-issue.ts`）共用，
 * 放在这个文件而不是各自文件里，是因为它描述的是**端口这一侧的前提条件**
 * （"这条反馈有没有 issue 是仓储读出来的事实"），不是某一个用例独有的裁决。
 */
export class FeedbackNoGithubIssueError extends Error {
  constructor() {
    super("this feedback has no linked github issue yet");
  }
}

/**
 * 从提交人的 userId 解出一个可以发邮件的地址。
 *
 * ⚠ 独立小端口，不是把它塞进 `IdentityRepository`——那个接口今天没有任何一个
 *   "按 userId 查邮箱"的方法，反馈提交人邮箱这件事只有这一个用例需要，
 *   给 `IdentityRepository` 添一个全仓通用方法会让六份现有 fake（见
 *   `apps/api/tests/support/*-fakes.ts`）都被迫多实现一个用不到的方法。
 * ⚠ `credentials` 表按 `kernel-no-tenant-data` 记录（同 `pg-registration-repository.ts`
 *   读它的方式）：账号是全局的，不按组织分区，所以这个端口的实现**不经过
 *   `withTenant`**——这不是遗漏 RLS，是这张表本来就不受组织边界管辖。
 */
export interface FeedbackSubmitterDirectory {
  emailForUserId(userId: string): Promise<string | null>;
  /**
   * 一批提交人的显示名（后台列表用，`listFeedback` 只对正文可见的那些行查）。查不到的
   * id 不在返回的 Map 里——调用方据此投影成 `null`（契约 `FeedbackItem.submitterName`）。
   */
  displayNamesForUserIds(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export const FEEDBACK_SUBMITTER_DIRECTORY = Symbol("FeedbackSubmitterDirectory");
