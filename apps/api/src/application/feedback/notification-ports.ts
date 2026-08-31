/**
 * FB-2 —— "转开发"建 GitHub issue、任意转移发状态变更邮件，这两条副作用
 * 用到的端口。与 `ports.ts` 分开放，是因为那份文件管的是**反馈本身的存取**
 * （仓储），而这份管的是**分诊触发的两个外部系统调用**——形状不同、生命周期
 * 也不同（仓储绑租户，这两个不绑）。
 */

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

/**
 * 建一个 GitHub issue。
 *
 * ⚠ **不是** `packages/coord-projection/src/github-app.ts` 那一套——那是 GitHub App
 *   + JWT，服务的是 Cloudflare Workers CI projection 那种需要装 App、需要短时安装
 *   token 的场景。这里只是"拿一个 classic PAT 建一个 issue"，用那一套完全是杀鸡用
 *   牛刀，还会把两个毫不相关的子系统绑在一起——牛刀本身也换不了刀刃的形状：
 *   建 issue 不需要"以某个 installation 的名义"，只需要一个有 `repo` 权限的 token。
 */
export interface GithubIssueCreator {
  create(draft: GithubIssueDraft): Promise<CreatedGithubIssue>;
}

export const GITHUB_ISSUE_CREATOR = Symbol("GithubIssueCreator");

export class GithubIssueCreationError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "github issue creation failed" : `github issue creation failed (http ${status})`);
    this.name = "GithubIssueCreationError";
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
}

export const FEEDBACK_SUBMITTER_DIRECTORY = Symbol("FeedbackSubmitterDirectory");
