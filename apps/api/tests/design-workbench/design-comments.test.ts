/**
 * 深度 S2（#3988）—— 批注存在服务端：全组织可读可写，删除限作者或 owner，项目有上限。
 */
import { describe, expect, it } from "vitest";
import { designWorkbench as C } from "@repo/contracts";
import {
  DesignCommentLimitError,
  DesignCommentNotFoundError,
  NotCommentAuthorError,
  createDesignComment,
  deleteDesignComment,
  listDesignComments,
  updateDesignComment,
} from "../../src/application/design-workbench/design-comments";
import { DesignProjectNotFoundError } from "../../src/application/design-workbench/project-shared";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignCommentRepo, FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";

function setup() {
  const projects = new FakeDesignProjectRepo();
  projects.seed(designProjectRow({ id: "dp-1", ownerId: "owner", frames: ["页"], prototype: [{ id: "n1", type: "stack", children: [] }] }));
  const comments = new FakeDesignCommentRepo();
  let n = 0;
  const deps = {
    projects, orgId: toOrgId("org-1"), comments, newId: () => `c-${++n}`,
    submitters: { emailForUserId: async () => null, displayNamesForUserIds: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `名字-${id}`])) },
  };
  return { deps, comments };
}
const input = (authorId: string, text = "按钮再醒目一点") => ({ projectId: "dp-1", authorId, nodeId: "n1", frameIndex: 0, label: "按钮「购买」", text });

describe("深度 S2 批注", () => {
  it("不是 owner 也能写；列表按先后、带作者名、过契约", async () => {
    const { deps } = setup();
    await createDesignComment(deps, input("colleague"));
    await createDesignComment(deps, input("owner", "  文案再短一点  "));
    const { items } = await listDesignComments(deps, { projectId: "dp-1" });
    expect(items.map((c) => [c.text, c.authorName, c.resolved])).toEqual([["按钮再醒目一点", "名字-colleague", false], ["文案再短一点", "名字-owner", false]]);
    expect(C.operations.listDesignComments.out.parse({ items })).toBeTruthy();
  });

  it("解决 / 重新打开：任何人都可以（那是讨论本身）；不存在的批注 ⇒ COMMENT_NOT_FOUND", async () => {
    const { deps } = setup();
    const { comment } = await createDesignComment(deps, input("colleague"));
    expect((await updateDesignComment(deps, { projectId: "dp-1", commentId: comment.id, resolved: true })).comment.resolved).toBe(true);
    expect((await updateDesignComment(deps, { projectId: "dp-1", commentId: comment.id, resolved: false })).comment.resolved).toBe(false);
    await expect(updateDesignComment(deps, { projectId: "dp-1", commentId: "nope", resolved: true })).rejects.toBeInstanceOf(DesignCommentNotFoundError);
  });

  it("删除：作者或 owner 可以，别人不行", async () => {
    const { deps, comments } = setup();
    const a = (await createDesignComment(deps, input("colleague"))).comment;
    const b = (await createDesignComment(deps, input("colleague"))).comment;
    await expect(deleteDesignComment(deps, { projectId: "dp-1", commentId: a.id, viewerId: "stranger" })).rejects.toBeInstanceOf(NotCommentAuthorError);
    await deleteDesignComment(deps, { projectId: "dp-1", commentId: a.id, viewerId: "colleague" });
    await deleteDesignComment(deps, { projectId: "dp-1", commentId: b.id, viewerId: "owner" });
    expect(comments.rows).toHaveLength(0);
  });

  it("项目不存在 ⇒ PROJECT_NOT_FOUND；到上限 ⇒ COMMENT_LIMIT_REACHED", async () => {
    const { deps, comments } = setup();
    await expect(listDesignComments(deps, { projectId: "nope" })).rejects.toBeInstanceOf(DesignProjectNotFoundError);
    for (let i = 0; i < C.DESIGN_COMMENT_MAX_PER_PROJECT; i++) comments.rows.push({ id: `x${i}`, projectId: "dp-1", authorId: "a", nodeId: "n1", frameIndex: 0, label: "", text: "t", resolved: false, createdAt: "2026-09-24T00:00:00.000Z" });
    await expect(createDesignComment(deps, input("colleague"))).rejects.toBeInstanceOf(DesignCommentLimitError);
  });
});
