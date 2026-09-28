/**
 * B3-T3（issue #4497）—— 项目大脑的跨来源推理只读：`getProjectReasoning`。
 *
 * 可见性与 `getProjectKnowledge` 是同一份判定（`authorizeProjectViewer`：项目成员含观察者 + `authorize(read.published)`），
 * 两个守卫读（结论 / 边 / 实体，以及每条结论的证据锚点）都用这一个决策 disclose；然后交给 domain 纯函数
 * `computeProjectReasoning`——不调模型、不落库，每次现算，`computedAt` 记下算出的时刻。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { computeProjectReasoning } from "../../domain/knowledge-graph/project-reasoning";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { authorizeProjectViewer } from "./read-project-knowledge";
import { KgReadError, type KnowledgeReadDeps } from "./read-thread-knowledge";

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}

export interface ProjectReasoningDeps extends KnowledgeReadDeps {
  /** 可注入的时钟（单测钉住 `computedAt`）；缺省 = 系统时间 */
  readonly now?: () => Date;
}

export async function getProjectReasoning(
  deps: ProjectReasoningDeps,
  input: Viewer & { readonly projectId: string },
): Promise<z.infer<typeof KG.knowledgeGraph.getProjectReasoning.out>> {
  const base = await authorizeProjectViewer(deps, input);
  const knowledge = discloseDecided(await deps.knowledge.projectKnowledge(input.orgId, input.userId, input.projectId), base);
  if (!isDisclosed(knowledge)) throw new KgReadError("KG_NOT_VISIBLE");
  const evidence = discloseDecided(await deps.knowledge.projectClaimEvidence(input.orgId, input.userId, input.projectId), base);
  if (!isDisclosed(evidence)) throw new KgReadError("KG_NOT_VISIBLE");
  const { claims, edges, objects } = knowledge.payload;
  const computed = computeProjectReasoning({ claims, edges, objects, evidence: evidence.payload });
  return { ...computed, computedAt: (deps.now ?? (() => new Date()))().toISOString() };
}
