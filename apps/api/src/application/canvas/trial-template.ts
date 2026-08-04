/**
 * `trialTemplate` —— 三段发布流程的第二段：在**一个**项目里试跑。
 *
 * ⚠ 契约的 `projectId` 是单值，不接受多选，所以这里也不接受数组。
 *
 * ## `projectId` 目前没有被写进任何地方，且这一点是**说出来**的
 *
 * 契约收了它，`trialTemplate.out` 里却没有它，`canvas_templates` 也没有「在哪试跑」这一列。
 * 试跑记录（哪个项目、谁发起、什么时候）是一张本 issue 没有建的表——建一张没有读者的表，
 * 与留一个没人调用的端口是同一类债。所以这里如实地只用它做入参校验，
 * 缺口报在 #463，而不是造一个字段让它看起来被处理过了。
 */
import { transition } from "../../domain/canvas/template-lifecycle";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError, CanvasIllegalTransitionError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type { CanvasTemplateRepository } from "./template-ports";

export interface TrialTemplateDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface TrialTemplateInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly version: number;
  readonly projectId: string;
}

export async function trialTemplate(
  deps: TrialTemplateDeps,
  input: TrialTemplateInput,
): Promise<{ readonly key: string; readonly version: number; readonly status: "trial" }> {
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const current = await deps.templates.findVersion(input.orgId, input.key, input.version);
  if (current === null) throw new CanvasError("TEMPLATE_NOT_FOUND");

  const next = transition(current.state, "trial");
  if (!next.ok) throw new CanvasIllegalTransitionError(next.reason);

  await deps.templates.setState(input.orgId, input.key, input.version, next.next);
  return { key: input.key, version: input.version, status: "trial" };
}
