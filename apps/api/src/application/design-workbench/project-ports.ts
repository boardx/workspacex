/**
 * UC-17.8 B4.3 —— 设计项目的仓储端口。
 *
 * ## 可见性口径决定了这个接口的形状（与 `draft-ports.ts` 正相反）
 *
 * 草稿是提交人私有物，`draft-ports.ts` 的每一个方法都接 `ownerId` 且用它收窄查询。
 * 设计项目是「组织内全员可读，仅 owner 可改/删/推送」（契约 `design-workbench.ts` 头注
 * 【待确认点 1】）——所以：
 *
 *   · **读**（`get` / `listForOrg`）不接 `ownerId`：任何组织成员都能读到任意一条项目。
 *   · **写**（`update` / `delete` / `appendChat` / `pushToInbox`）**必须**接 `ownerId`，
 *     且实现把它写进 SQL 谓词（`owner_id = $n`），不是先查出来再在应用层比对——同
 *     `FeedbackDraftRepository` 头注的理由：两步之间没有窗口可言，但"读出来再比"意味着
 *     一条忘了比的路径会把别人的项目改写掉。不存在**或不是 owner** ⇒ 返回 `null`/`false`，
 *     用例层据此抛 `NOT_PROJECT_OWNER`（不是 404——项目本身存在且对请求者可见，见契约
 *     `DesignWorkbenchError.NOT_PROJECT_OWNER` 头注：这与草稿"不是 owner 就等同不存在"
 *     是两条不同的门，草稿全组织都看不到，设计项目全组织都看得到、只是改不了）。
 *
 * ⚠ 仓储按组织构造（`forOrg`），同 `FeedbackDraftRepositoryFactory`。
 */
import type { z } from "zod";
import type { designPrototype, designWorkbench } from "@repo/contracts";

export const DESIGN_PROJECT_REPOSITORY = Symbol("DesignProjectRepository");

export type ProjectTemplate = z.infer<typeof designWorkbench.ProjectTemplate>;
export type DesignProjectChatTurn = z.infer<typeof designWorkbench.DesignProjectChatTurn>;
export type PrototypeNode = z.infer<typeof designPrototype.PrototypeNode>;

export interface DesignProjectRow {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly problem: string;
  readonly criteria: readonly string[];
  readonly frames: readonly string[];
  /** B5.3：按位置对应 `frames[i]` 的组件树；`[]` = 还没生成（契约 `DesignProject.prototype` 不变量）。 */
  readonly prototype: readonly PrototypeNode[];
  /** 迭代 8：每页交互说明，与 `frames` 同长或空。 */
  readonly frameNotes: readonly string[];
  readonly pushed: boolean;
  readonly pushedAt: string | null;
  readonly pushNote: string | null;
  readonly linkedFeedbackId: string | null;
  readonly chat: readonly DesignProjectChatTurn[];
  /**
   * 2026-09-05「转开发」——这个方案对应的 GitHub issue。同生同灭（见契约
   * `DesignProject.githubIssueUrl` 头注）。**没有** issue 开关状态：设计方案不落
   * `dev_status` 列，理由见迁移 `20260905180000_design_project_github_issue.sql`。
   */
  readonly githubIssueUrl: string | null;
  readonly githubIssueNumber: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 迭代 3：一条原型版本快照（存储行；投影到契约 `PrototypeVersion`）。 */
export interface PrototypeVersionRow {
  readonly id: string;
  readonly projectId: string;
  readonly seq: number;
  readonly source: "model" | "user" | "restore";
  readonly summary: string;
  readonly frames: readonly string[];
  readonly prototype: readonly PrototypeNode[];
  readonly notes: readonly string[];
  readonly createdAt: string;
}

/** 随 `update` 一起落的版本元数据；`frames`/`prototype` 取 UPDATE 之后的行，不由调用方另给一份。 */
export interface NewPrototypeVersionMeta {
  readonly source: "model" | "user" | "restore";
  readonly summary: string;
}

export interface NewDesignProject {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly problem: string;
  readonly criteria: readonly string[];
  readonly frames: readonly string[];
  /** 新建恒为 `[]`——树只由模型经对话写回。 */
  readonly prototype: readonly PrototypeNode[];
  readonly frameNotes: readonly string[];
  readonly linkedFeedbackId: string | null;
}

/**
 * 只带要改的字段。`updateProject` 用前三个（同新建弹窗字段集）；`criteria`/`frames` 是
 * UC-17.8 B5.2 `appendProjectChat` 的模型写回专用——用户没有直接编辑它们的入口（契约
 * `updateProject.in` 不收这两个字段），用例层只在 `DesignChatWriteback` 严格解析通过后才填。
 * 不碰 `chat`（那走 `appendChat`）。
 */
export interface DesignProjectPatch {
  readonly name?: string;
  readonly template?: ProjectTemplate;
  readonly problem?: string;
  readonly criteria?: readonly string[];
  readonly frames?: readonly string[];
  /**
   * B5.3：与 `frames` 一起给 ⇒ 整页重生成（长度必须相等，`append-project-chat.ts` 负责拆）；
   * 只给 `frames` 不给 `prototype` ⇒ 仓储把 `prototype` 清成 `[]`（标签变了，旧树不再对应）。
   */
  readonly prototype?: readonly PrototypeNode[];
  /** 迭代 8：与 `frames` 一起给；只给 `frames` 不给它 ⇒ 仓储清成 `[]`。 */
  readonly frameNotes?: readonly string[];
}

/**
 * `pushToInbox` 本次**首次**回写 `resolved_by_design_id` 的那条来源反馈——用例层据此给提交人
 * 发「已生成设计方案」邮件（B6.3），所以带上发信要用的两个字段，不让用例层再回头用
 * `ProductFeedbackRepository.findById`（那条读要过 D3 可见性判定，而这里只是"给提交人发信"，
 * 不该被"推送者能不能看正文"这道门卡住）。
 */
export interface ResolvedFeedbackRef {
  readonly id: string;
  readonly submittedBy: string;
  readonly title: string;
}

/** `pushToInbox` 的落库结果——见 `DesignProjectRepository.pushToInbox` 头注的事务边界。 */
export interface PushToInboxResult {
  readonly project: DesignProjectRow;
  /**
   * 本次调用**真的把** `resolved_by_design_id` 从别的值（含 NULL）写成本项目的那条反馈；
   * `linkedFeedbackId` 为空、反馈行不在本组织、或**上一次推送已经写过**（幂等重放）⇒ `null`。
   * 后一条是 B6.3 的通知去重依据：同一条反馈只在外键首次指向它时通知一次，重复推送
   * 只刷新 `pushed_at`/`push_note`，不再发第二封邮件。
   */
  readonly resolvedFeedback: ResolvedFeedbackRef | null;
}

/** `createOrGetByLinkedFeedback` 的落库结果——`created` 区分这次是不是真的插入了新行。 */
export interface CreateOrGetByLinkedFeedbackResult {
  readonly project: DesignProjectRow;
  readonly created: boolean;
}

export interface DesignProjectRepository {
  create(project: NewDesignProject): Promise<void>;
  /**
   * B4.4 `deepenFeedback` 专用——`linkedFeedbackId` 非空，幂等键就是它（迁移
   * `20260904160000_uc178_b44_deepen_feedback_uniq.sql` 的 `(org_id, linked_feedback_id)`
   * 部分唯一索引）。单条 `INSERT ... ON CONFLICT ... DO NOTHING` 内完成"没有就建、有就复用"，
   * 不是应用层先查后插的两步（那两步之间有窗口，见该迁移头注）。`created=false` 时返回的是
   * **已存在**的那一行,不是本次传入的字段——已存在项目的 owner 可能不是这次调用的
   * `project.ownerId`（先深化的人与后重试的人可能不是同一账号）,这正是幂等要表达的：
   * 不因为"谁发起了这次调用"而改变已经产生的事实。
   */
  createOrGetByLinkedFeedback(
    project: NewDesignProject & { readonly linkedFeedbackId: string },
  ): Promise<CreateOrGetByLinkedFeedbackResult>;
  /** 全组织可读——listMyProjects 的 owner 过滤（`q` 也一样）在应用层做，见 `list-my-projects.ts`。 */
  listForOrg(): Promise<readonly DesignProjectRow[]>;
  /** 不存在 ⇒ `null`。全组织可读，不接 `ownerId`。 */
  get(projectId: string): Promise<DesignProjectRow | null>;
  /**
   * 一条 UPDATE，`updated_at = now()`。不存在/不是 owner ⇒ `null`（用例层转 `NOT_PROJECT_OWNER`）。
   * 迭代 3：可选 `version`——**同一事务**里在 UPDATE 之后追加一条版本快照（`frames`/`prototype` 取
   * UPDATE 后的行）。UPDATE 先锁住项目行，所以同一项目的 `seq = max+1` 在并发写回之间天然串行，
   * 不需要额外的计数器；两步要么都成、要么都不成（Codex：历史不能与当前原型分叉）。
   */
  update(projectId: string, ownerId: string, patch: DesignProjectPatch, version?: NewPrototypeVersionMeta): Promise<DesignProjectRow | null>;
  /**
   * 追加一条对话消息（`design_project_chat_messages`，append-only）。仅 owner。
   * 不存在/不是 owner ⇒ `null`；成功时返回追加后的完整行（含新的 `chat`）。
   */
  appendChat(projectId: string, ownerId: string, turns: readonly Omit<DesignProjectChatTurn, "at">[]): Promise<DesignProjectRow | null>;
  /** 硬删。仅 owner。返回是否真的删了一行。 */
  delete(projectId: string, ownerId: string): Promise<boolean>;
  /** 迭代 3：版本列表（不带树），按 seq 倒序。项目不存在 ⇒ `[]`（调用方先 `get` 判存在）。全组织可读。 */
  listVersions(projectId: string): Promise<readonly Omit<PrototypeVersionRow, "prototype">[]>;
  /** 迭代 3：单条（带树）。不存在 / 不属于该项目 ⇒ `null`。 */
  getVersion(projectId: string, versionId: string): Promise<PrototypeVersionRow | null>;
  /** 迭代 3：`update(..., version)` 之后这次调用记下的那条版本（同一返回里带回，省一次查询）。 */
  lastRecordedVersion(): Omit<PrototypeVersionRow, "prototype"> | null;
  /**
   * `pushToInbox` 的落库半程——**一次数据库事务**内完成：
   *   ① 标记 `pushed=true, pushed_at=now()`，`push_note` 按传入值覆盖（`undefined` ⇒ 不改）。
   *   ② 若该项目 `linked_feedback_id` 非空，同一事务里把那条反馈的 `resolved_by_design_id`
   *      指向本项目——这正是文件头「两个方向的写在同一次调用里完成」的落地位置：不存在跨事务
   *      窗口能让①成功②失败（或反过来）从而让两个外键漂移。反馈行不存在/不属于本组织时②静默
   *      跳过（`linked_feedback_id` 允许指向一条后来被清理的反馈，不阻塞推送本身），
   *      `resolvedFeedback` 如实回报这一步有没有真的发生——且**只在外键值真的变了**时非空
   *      （SQL 谓词 `resolved_by_design_id IS DISTINCT FROM <本项目>`），重复推送回 `null`，
   *      见 `PushToInboxResult.resolvedFeedback` 头注。
   * 不存在/不是 owner ⇒ `null`。
   */
  pushToInbox(projectId: string, ownerId: string, note: string | undefined): Promise<PushToInboxResult | null>;

  /**
   * 2026-09-05「转开发」——认领"由我来给这个方案建 issue"的权利。
   *
   * 与 `ProductFeedbackRepository.claimGithubIssueCreation` **完全同一套语义**（那份
   * 迁移头注 `20260831010000_fb2_feedback_github_issue_claim.sql` 是这把锁的权威说明，
   * 包含它不解决的那种竞态）：把 `github_issue_claimed_at` 从 `NULL`（或够旧的旧值）
   * 原子地改成"现在"，`RETURNING` 到行的人才有权调 GitHub。
   *
   * 返回 `false` = 没抢到（别人正在办，或刚办完）。仅 owner；不是 owner 一律 `false`
   * ——调用方在这之前已经用 `get()` 判过 owner 并抛过 `NOT_PROJECT_OWNER`，这里的
   * owner 谓词是防"判过之后 owner 变了"的第二道，不是错误来源。
   */
  claimGithubIssueCreation(projectId: string, ownerId: string): Promise<boolean>;
  /**
   * 建失败时释放认领，让下一次重试能立刻重新抢到（不必等过期）。
   *
   * ⚠ 带 `ownerId` 不是多余的：`design_projects` 上**每一条** UPDATE 都必须同时按
   *   `owner_id` 与 `org_id` 收窄——这是 `lint-permission-paths` 对本仓储的豁免前提，
   *   由 `tests/design-workbench/project-repository-guard.test.ts` 逐条扫 SQL 字面量守着。
   *   反馈那侧的同名方法只按 id+org 收窄，是因为 `product_feedback` 没有这条不变量。
   */
  releaseGithubIssueClaim(projectId: string, ownerId: string): Promise<void>;
  /** 建成功后回填 url/number。返回回填之后的行；不存在/不是 owner ⇒ `null`。 */
  setGithubIssue(
    projectId: string,
    ownerId: string,
    issue: { readonly url: string; readonly number: number },
  ): Promise<DesignProjectRow | null>;
}

export interface DesignProjectRepositoryFactory {
  forOrg(orgId: string): DesignProjectRepository;
}
