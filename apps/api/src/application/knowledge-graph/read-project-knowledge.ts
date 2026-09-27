/**
 * 项目中枢 R8 —— 项目大脑只读：一个项目的项目记忆（L2）。
 *
 * 判定：① 必须是项目成员（`project_memberships`，观察者也算——项目记忆本就是给全体成员的）；
 * ② 再走 `authorize(read.published)` 对着项目对象本身（组织层 / 冻结 / 管理员未提升等既有判定），
 * 用它的决策去 disclose。两道门任一不过 ⇒ `KG_NOT_VISIBLE`（403，同个人空间：不泄露第二次存在性）。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { authorize } from "../identity/authorize";
import { AuthzUnavailableError } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { KgReadError, type KnowledgeReadDeps } from "./read-thread-knowledge";

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}

export async function getProjectKnowledge(
  deps: KnowledgeReadDeps,
  input: Viewer & { readonly projectId: string },
): Promise<z.infer<typeof KG.knowledgeGraph.getProjectKnowledge.out>> {
  // 项目记忆是给项目成员的：先看 `project_memberships`（观察者也是成员），不在 ⇒ 看不见。
  // 不只靠 `authorize(read.published)`——对一个没有 ACL 绑定的项目对象，它在组织层就放行了，
  // 那是「已发布内容对组织成员可读」的语义，不是「项目成员」的语义（单测反证抓出来的）。
  let membership;
  try {
    membership = await deps.repo.findProjectMembership(input.userId, input.projectId, input.orgId);
  } catch {
    throw new AuthzUnavailableError();
  }
  if (membership === null) throw new KgReadError("KG_NOT_VISIBLE");
  let base: PermissionDecision;
  try {
    base = await authorize(
      { repo: deps.repo, ids: deps.ids },
      { userId: input.userId, orgId: input.orgId, object: { kind: "project", id: input.projectId }, action: "read.published" },
    );
  } catch {
    // 判定依赖读不到 ⇒ 拒绝并报 503，不降级为放行（同 resolveVisibility）。
    throw new AuthzUnavailableError();
  }
  const guarded = await deps.knowledge.projectKnowledge(input.orgId, input.userId, input.projectId);
  const d = discloseDecided(guarded, base);
  if (!isDisclosed(d)) throw new KgReadError("KG_NOT_VISIBLE");
  return { scope: { kind: "project", id: input.projectId }, ...d.payload };
}
