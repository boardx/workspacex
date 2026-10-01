/**
 * 项目中枢 B3-T4（issue #4498）—— 成果回流：把项目记忆里的一条 fact / hypothesis **采纳为项目决策**。
 *
 * 与 `promote-to-org.ts` 同构（读来源 → 数据库函数复制一条 + derived_from 连回 + 审计），只有三处不同：
 *   · 谁能做：**项目成员且不是观察者**——非成员 `KG_NOT_VISIBLE`（同 `getProjectKnowledge`：项目记忆只对成员存在），
 *     观察者 `KG_NOT_OWNER`（只有 read.published，替项目定决策不够；沿用现有码不新增）；
 *   · 来源：本项目项目作用域里活着的 fact / hypothesis（`promotion.adoptionSource`），其余类型 / 不在项目记忆里
 *     ⇒ `KG_CLAIM_NOT_FOUND`；有未解矛盾 ⇒ `KG_CONTESTED_NEEDS_RESOLUTION`；
 *   · 不去重：同一条来源可以被采纳多次（各自成条，取代关系交给既有 supersedes）。
 * 落库判定住在 `kg_adopt_project_decision`（迁移 20260928110000）按同一套规则复核；这里只编排。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { authorize } from "../identity/authorize";
import { resolveProjectLayer } from "../identity/project-layer";
import { AuthzUnavailableError } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { KgReadError } from "./read-thread-knowledge";
import { KgHumanActionError } from "./ports";
import type { PromotionDeps } from "./promote-to-personal";

interface Input {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly claimId: string;
  readonly rationale: string;
}

/**
 * 项目成员（非观察者），且看得到这个项目（组织层 / 冻结 / 团队绑定等既有判定）。
 *
 * #4615：项目层身份走 `resolveProjectLayer`（唯一判据）——工作坊行照旧；通用项目负责人 / 协作者分别映射到
 * facilitator / member 行，名单外的组织 lead / admin 映射到 observer 行（只读 ⇒ KG_NOT_OWNER）。
 * 数据库函数 `kg_adopt_project_decision`（迁移 20260929110100）按同一张映射复核。
 */
async function requireProjectDecider(deps: PromotionDeps, input: Input) {
  let role;
  try {
    const org = await deps.repo.findOrgMembership(input.userId, input.orgId);
    role = (await resolveProjectLayer(deps.repo, {
      userId: input.userId, projectId: input.projectId, orgId: input.orgId, orgRole: org?.orgRole ?? null,
    })).role;
  } catch {
    throw new AuthzUnavailableError();
  }
  if (role === null) throw new KgReadError("KG_NOT_VISIBLE");
  if (role === "observer") throw new KgHumanActionError("KG_NOT_OWNER", "observers take no project decisions");
  let project: PermissionDecision;
  try {
    project = await authorize(
      { repo: deps.repo, ids: deps.ids },
      { userId: input.userId, orgId: input.orgId, object: { kind: "project", id: input.projectId }, action: "read.published" },
    );
  } catch {
    throw new AuthzUnavailableError();
  }
  if (!project.allowed) throw new KgReadError("KG_NOT_VISIBLE");
  return <T>(g: Guarded<T>): T => {
    const d = discloseDecided(g, project);
    if (!isDisclosed(d)) throw new KgReadError("KG_NOT_VISIBLE");
    return d.payload;
  };
}

export async function adoptProjectDecision(
  deps: PromotionDeps,
  input: Input,
): Promise<z.infer<typeof KG.knowledgeGraph.adoptProjectDecision.out>> {
  const rationale = input.rationale.trim();
  if (rationale.length < 1 || rationale.length > KG.KG_ADOPT_RATIONALE_MAX) throw new KgHumanActionError("KG_INVALID_REQUEST");
  const reveal = await requireProjectDecider(deps, input);
  const src = reveal(await deps.promotion.adoptionSource(input.orgId, input.userId, input.projectId, input.claimId));
  // 不在项目记忆里、已失效、类型不对：同一个出口（不泄露第二次存在性）。
  if (src === null || !KG.isAdoptableClaimKind(src.kind)) throw new KgHumanActionError("KG_CLAIM_NOT_FOUND");
  if (src.status === "contested") throw new KgHumanActionError("KG_CONTESTED_NEEDS_RESOLUTION");
  return deps.promotion.adoptProjectDecision(input.orgId, input.userId, {
    actionId: deps.newId("act"), projectId: input.projectId, claimId: src.id, rationale,
  });
}
