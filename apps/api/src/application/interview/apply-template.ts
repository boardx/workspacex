/**
 * `applyTemplate` —— 套用模板新建/挂到访谈（主线第二步，uc-6-1 R3 步骤4，AC1 / V1 / V4）。
 *
 * ⚠ 一次性带入**三样**：分段 + 每段时长 + 要收集的数据字段。第三样最常被漏——
 * 它是 UC-6.5 证据矩阵能成列的前提（contracts/interview.ts `applyTemplate` 注释原文）。
 *
 * ## 套用即脱钩落在哪一步
 *
 * `deps.repo.apply()` 把当前版本的 `sections`/`dataFields` **复制**进
 * `interview_template_applications` 这一场访谈自己的行，而不是让访谈引用模板版本再实时联查。
 * 复制之后，`updateTemplate` 产生的任何新版本都不会 touch 这一行——反证见
 * `tests/itv/template-apply-three-things-detached.test.ts`：套用之后编辑模板，
 * 断言这场访谈读到的三样东西一个字节都没变。
 *
 * ⚠ 这里没有权限判断（不像 `attachToProjectStep`）：模板可见范围三档＝[待定 D-16]，
 * 现在没有一条被裁定的规则可判；`targetInterviewId` 指向的访谈是否存在，交给数据库外键
 * （不存在 ⇒ 抛 `NO_INTERVIEW_ACCESS`，与「无权/不存在同一答案」的通用立场一致）。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdFactory } from "../artifact/ports";
import { NoInterviewAccessError } from "./errors";
import type { ApplyTemplateResult, TemplateRepository } from "./template-ports";

export interface ApplyTemplateDeps {
  readonly repo: TemplateRepository;
  readonly ids: IdFactory;
}

export interface ApplyTemplateDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly templateId: string;
  /** `null` = 套用当前 head。 */
  readonly versionId: string | null;
  /** `null` = 新建一场访谈来承接套用结果；非空 = 套到已存在的那一场。 */
  readonly targetInterviewId: string | null;
}

export async function applyTemplate(
  deps: ApplyTemplateDeps,
  input: ApplyTemplateDto,
): Promise<ApplyTemplateResult> {
  try {
    return await deps.repo.apply({
      orgId: input.orgId,
      templateId: input.templateId,
      versionId: input.versionId,
      targetInterviewId: input.targetInterviewId,
      newInterviewId: deps.ids.next("itv"),
      applicationId: deps.ids.next("tplapp"),
      actorId: input.actorId,
    });
  } catch (e) {
    // 数据库外键/租户过滤发现「目标访谈不存在或不属于本组织」时的落点。
    // 与其它读写一致：不存在与无权同一个答案（uc-6-0/E3），不在这里区分两者。
    if (input.targetInterviewId !== null && isMissingInterviewError(e)) {
      throw new NoInterviewAccessError(input.targetInterviewId);
    }
    throw e;
  }
}

function isMissingInterviewError(e: unknown): boolean {
  return e instanceof Error && /interview_id|interview_sessions/i.test(e.message);
}
