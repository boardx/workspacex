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
import type { designWorkbench } from "@repo/contracts";

export const DESIGN_PROJECT_REPOSITORY = Symbol("DesignProjectRepository");

export type ProjectTemplate = z.infer<typeof designWorkbench.ProjectTemplate>;
export type DesignProjectChatTurn = z.infer<typeof designWorkbench.DesignProjectChatTurn>;

export interface DesignProjectRow {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly problem: string;
  readonly criteria: readonly string[];
  readonly frames: readonly string[];
  readonly pushed: boolean;
  readonly pushedAt: string | null;
  readonly pushNote: string | null;
  readonly linkedFeedbackId: string | null;
  readonly chat: readonly DesignProjectChatTurn[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewDesignProject {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly problem: string;
  readonly criteria: readonly string[];
  readonly frames: readonly string[];
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
  /** 一条 UPDATE，`updated_at = now()`。不存在/不是 owner ⇒ `null`（用例层转 `NOT_PROJECT_OWNER`）。 */
  update(projectId: string, ownerId: string, patch: DesignProjectPatch): Promise<DesignProjectRow | null>;
  /**
   * 追加一条对话消息（`design_project_chat_messages`，append-only）。仅 owner。
   * 不存在/不是 owner ⇒ `null`；成功时返回追加后的完整行（含新的 `chat`）。
   */
  appendChat(projectId: string, ownerId: string, turns: readonly Omit<DesignProjectChatTurn, "at">[]): Promise<DesignProjectRow | null>;
  /** 硬删。仅 owner。返回是否真的删了一行。 */
  delete(projectId: string, ownerId: string): Promise<boolean>;
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
}

export interface DesignProjectRepositoryFactory {
  forOrg(orgId: string): DesignProjectRepository;
}
