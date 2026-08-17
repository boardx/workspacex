/**
 * F192（design-delta `skill-model-a-b-convergence` 选项②）之后的测试夹具助手。
 *
 * `POST /skills` 已冻结为 410（`skill.controller.ts` 不再暴露 `create`），
 * 所以任何**只是想在库里先种一条模型 B 草稿、以便测别的东西**（列表成员资格 /
 * 详情成员资格 / 双重门禁 / 审核人指派……）的测试，不能再借道 HTTP 写入口。
 *
 * 直接调用应用层 `createSkillDraft`（该函数本身未变、未废弃，只是不再挂在
 * HTTP 路由上），用真实 DI 容器里解出的同一批适配器（`SKILL_CONTRACT_REPOSITORY` /
 * `SKILL_SUBMITTER_GRANTS` / `SKILL_SECURITY_AUDIT`）——与 controller 冻结前用的
 * 完全同一套，落库形状不变，测试断言的仍然是真实 PostgreSQL 里的那一行。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createSkillDraft } from "../../src/application/skill/create-skill-draft";
import {
  SKILL_CONTRACT_REPOSITORY,
  SKILL_SECURITY_AUDIT,
  SKILL_SUBMITTER_GRANTS,
  type SecurityAuditPort,
  type SkillContractRepositoryFactory,
  type SubmitterGrantsPort,
} from "../../src/application/skill/ports";

export interface SkillDraftFixtureContract {
  readonly promptTemplate: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly dataScope: readonly string[];
  readonly readsRawTranscript: boolean;
  readonly fallbackDeclaration: string;
}

export interface SeedSkillDraftInput {
  readonly orgId: string;
  readonly submitterId: string;
  readonly name: string;
  readonly duty?: string;
  readonly contract: SkillDraftFixtureContract;
  readonly visibility: "org-wide" | "team-only";
  readonly ownerTeamId?: string | null;
  readonly modelRef?: string;
  readonly tags?: readonly string[];
}

/**
 * 种一条模型 B 草稿（`skill_contracts` + `skill_contract_versions` 各一行），
 * 绕过已冻结的 `POST /skills`，走的是应用层同一套校验/落库逻辑。
 *
 * 抛错而非返回 `ok:false`——种子建不出来时，测试应该在 `beforeEach`/setup 阶段
 * 就炸，而不是把「fixture 没建成」悄悄传成断言失败,让人误以为是被测行为本身红了。
 */
export async function seedSkillDraft(
  app: NestExpressApplication,
  input: SeedSkillDraftInput,
): Promise<{ skillId: string; versionId: string }> {
  const repositories = app.get<SkillContractRepositoryFactory>(SKILL_CONTRACT_REPOSITORY);
  const grants = app.get<SubmitterGrantsPort>(SKILL_SUBMITTER_GRANTS);
  const audit = app.get<SecurityAuditPort>(SKILL_SECURITY_AUDIT);
  const store = repositories.forOrg(input.orgId);

  const result = await createSkillDraft(
    {
      orgId: input.orgId,
      submitterId: input.submitterId,
      name: input.name,
      duty: input.duty ?? "访谈纪要 → 结论",
      contract: { ...input.contract, dataScope: [...input.contract.dataScope] },
      entry: "admin-new",
      visibility: input.visibility,
      ownerTeamId: input.ownerTeamId ?? null,
      modelRef: input.modelRef ?? "model-default",
      tags: input.tags,
      rawBody: undefined,
    },
    { grants, store, audit },
  );

  if (!result.ok) {
    throw new Error(
      `seedSkillDraft 失败（fixture 阶段,不是被测行为）：${result.code} — ${result.reason}`,
    );
  }
  return { skillId: result.skillId, versionId: result.versionId };
}
