/**
 * 深度 S2（#3988）—— 批注：钉在原型某个节点上的一句意见，存在服务端。
 *
 * 权限（与契约 `listDesignComments` 等的头注一致）：
 * - 读：全组织（同项目可见性）；
 * - 写一条 / 解决 / 重新打开：全组织——批注就是让不是 owner 的人也能说话；
 * - 删：作者本人或项目 owner。
 *
 * 仓储只按 org + project 收窄，**不**带任何人的谓词；谁能删在这里判一次（参考图同一个纪律）。
 */
import { designWorkbench } from "@repo/contracts";
import {
  DesignProjectNotFoundError,
  ownerNamesFor,
  type DesignProjectDeps,
} from "./project-shared";

export const DESIGN_COMMENT_REPOSITORY = Symbol("DESIGN_COMMENT_REPOSITORY");

export interface DesignCommentRow {
  readonly id: string;
  readonly projectId: string;
  readonly authorId: string;
  readonly nodeId: string;
  readonly frameIndex: number;
  readonly label: string;
  readonly text: string;
  readonly resolved: boolean;
  readonly createdAt: string;
}

export interface DesignCommentRepository {
  listComments(projectId: string): Promise<readonly DesignCommentRow[]>;
  countComments(projectId: string): Promise<number>;
  insertComment(row: Omit<DesignCommentRow, "createdAt" | "resolved">): Promise<DesignCommentRow>;
  /** 不存在（或不属于这个项目）⇒ `null`。 */
  setCommentResolved(projectId: string, commentId: string, resolved: boolean): Promise<DesignCommentRow | null>;
  getComment(projectId: string, commentId: string): Promise<DesignCommentRow | null>;
  deleteComment(projectId: string, commentId: string): Promise<boolean>;
}

export interface DesignCommentRepositoryFactory {
  forOrg(orgId: string): DesignCommentRepository;
}

export interface DesignCommentDeps extends DesignProjectDeps {
  readonly comments: DesignCommentRepository;
  readonly newId: () => string;
}

export class DesignCommentNotFoundError extends Error {}
export class NotCommentAuthorError extends Error {}
export class DesignCommentLimitError extends Error {}

async function requireProject(deps: DesignCommentDeps, projectId: string) {
  const project = await deps.projects.get(projectId);
  if (project === null) throw new DesignProjectNotFoundError();
  return project;
}

async function project(deps: DesignCommentDeps, rows: readonly DesignCommentRow[]): Promise<designWorkbench.DesignComment[]> {
  const names = await ownerNamesFor(deps, rows.map((r) => r.authorId));
  return rows.map((r) => ({
    id: r.id, nodeId: r.nodeId, frameIndex: r.frameIndex, label: r.label, text: r.text, resolved: r.resolved,
    authorId: r.authorId, authorName: names.get(r.authorId) ?? null, createdAt: r.createdAt, replies: [],
  }));
}

export async function listDesignComments(
  deps: DesignCommentDeps,
  input: { readonly projectId: string },
): Promise<{ readonly items: readonly designWorkbench.DesignComment[] }> {
  await requireProject(deps, input.projectId);
  return { items: await project(deps, await deps.comments.listComments(input.projectId)) };
}

export async function createDesignComment(
  deps: DesignCommentDeps,
  input: { readonly projectId: string; readonly authorId: string; readonly nodeId: string; readonly frameIndex: number; readonly label: string; readonly text: string },
): Promise<{ readonly comment: designWorkbench.DesignComment }> {
  await requireProject(deps, input.projectId);
  // 上限按项目判：跨行约束不进 CHECK（见迁移头注），应用层插入前先数。
  if ((await deps.comments.countComments(input.projectId)) >= designWorkbench.DESIGN_COMMENT_MAX_PER_PROJECT) {
    throw new DesignCommentLimitError();
  }
  const row = await deps.comments.insertComment({
    id: deps.newId(), projectId: input.projectId, authorId: input.authorId,
    nodeId: input.nodeId, frameIndex: input.frameIndex, label: input.label.slice(0, 200), text: input.text.trim(),
  });
  const [comment] = await project(deps, [row]);
  return { comment: comment! };
}

export async function updateDesignComment(
  deps: DesignCommentDeps,
  input: { readonly projectId: string; readonly commentId: string; readonly resolved: boolean },
): Promise<{ readonly comment: designWorkbench.DesignComment }> {
  await requireProject(deps, input.projectId);
  const row = await deps.comments.setCommentResolved(input.projectId, input.commentId, input.resolved);
  if (row === null) throw new DesignCommentNotFoundError();
  const [comment] = await project(deps, [row]);
  return { comment: comment! };
}

export async function deleteDesignComment(
  deps: DesignCommentDeps,
  input: { readonly projectId: string; readonly commentId: string; readonly viewerId: string },
): Promise<Record<string, never>> {
  const p = await requireProject(deps, input.projectId);
  const row = await deps.comments.getComment(input.projectId, input.commentId);
  if (row === null) throw new DesignCommentNotFoundError();
  if (row.authorId !== input.viewerId && p.ownerId !== input.viewerId) throw new NotCommentAuthorError();
  if (!(await deps.comments.deleteComment(input.projectId, input.commentId))) throw new DesignCommentNotFoundError();
  return {};
}
