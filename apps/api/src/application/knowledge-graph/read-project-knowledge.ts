/**
 * 项目中枢 R8 —— 项目大脑只读：一个项目的项目记忆（L2）。
 *
 * 判定：`authorize(read.published)` 带 projectId 对着项目对象本身——项目层 = 必须是项目成员（观察者也算，
 * 项目记忆本就是给全体成员的；#4584 起含研究项目 / 用户洞察的两档身份），组织层 = 冻结 / 管理员未提升 / 团队绑定
 * 等既有判定；用同一个决策去 disclose。任一层不过 ⇒ `KG_NOT_VISIBLE`（403，同个人空间：不泄露第二次存在性）。
 * B2-S4：响应多带 `canPromoteToOrg`（组织 lead / admin），项目大脑面板据此决定出不出「记到组织记忆」的入口。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { authorize } from "../identity/authorize";
import { AuthzUnavailableError } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { canPromoteToOrg, orgMembershipOf } from "./read-org-knowledge";
import { KgReadError, type KnowledgeReadDeps } from "./read-thread-knowledge";

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}

/**
 * 项目记忆的可见性判定，只此一份（`getProjectKnowledge` 与 B3-T3 `getProjectReasoning` 共用）：
 * 两道门都过才返回可用于 disclose 的决策；任一不过 ⇒ `KG_NOT_VISIBLE`；判定依赖读不到 ⇒ `AuthzUnavailableError`（503）。
 */
export async function authorizeProjectViewer(deps: KnowledgeReadDeps, input: Viewer & { readonly projectId: string }): Promise<PermissionDecision> {
  // 项目记忆是给项目成员的：`authorize()` **带着 projectId** 问，项目层就是「是不是成员」那道门
  // （`read.published` 四个角色都有，观察者也算）。不能不带 projectId 只问组织层——对一个没有
  // ACL 绑定的项目对象，组织层直接放行，那是「已发布内容对组织成员可读」的语义，不是「项目成员」
  // 的语义（单测反证抓出来的）。
  // #4584：此前这里先单独读 `findProjectMembership`（只认工作坊行），研究项目 / 用户洞察的负责人、
  // 协作者因此永远 KG_NOT_VISIBLE。现在成员资格由 `authorize()` 的项目层单一来源判
  // （`application/identity/project-layer.ts`），两类容器的两档身份与组织 lead/admin 只读同样生效。
  let decision: PermissionDecision;
  try {
    decision = await authorize(
      { repo: deps.repo, ids: deps.ids },
      {
        userId: input.userId,
        orgId: input.orgId,
        projectId: input.projectId,
        object: { kind: "project", id: input.projectId },
        action: "read.published",
      },
    );
  } catch {
    // 判定依赖读不到 ⇒ 拒绝并报 503，不降级为放行（同 resolveVisibility）。
    throw new AuthzUnavailableError();
  }
  if (!decision.allowed) throw new KgReadError("KG_NOT_VISIBLE");
  return decision;
}

export async function getProjectKnowledge(
  deps: KnowledgeReadDeps,
  input: Viewer & { readonly projectId: string },
): Promise<z.infer<typeof KG.knowledgeGraph.getProjectKnowledge.out>> {
  const base = await authorizeProjectViewer(deps, input);
  const guarded = await deps.knowledge.projectKnowledge(input.orgId, input.userId, input.projectId);
  const d = discloseDecided(guarded, base);
  if (!isDisclosed(d)) throw new KgReadError("KG_NOT_VISIBLE");
  // B2-S4：组织 lead / admin 才有「记到组织记忆」的入口（判据的唯一说明处在 read-org-knowledge.ts）。
  return {
    scope: { kind: "project", id: input.projectId }, ...d.payload,
    canPromoteToOrg: canPromoteToOrg(await orgMembershipOf(deps, input)),
  };
}
