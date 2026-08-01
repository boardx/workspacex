/**
 * 改进提案上线的**唯一写入口**（F68；UC-3.6 R3 阶段四，AC2 的结构性落点）。
 *
 * 与 `publish-new-version.ts`（F66）的关系：本文件只多做一件事——先问
 * `authorizeProposalRelease`「这份提案有没有被批准」，过了才转给 F66 的
 * `publishNewVersion` 走版本链本身的发布逻辑。**不重做**版本链的并发/归档判断。
 *
 * ⚠ `PROPOSAL_NOT_REVIEWED`（绕过复核直接调用本入口）**写安全审计**——
 *   与 `advance-skill-status.ts` 的 `GATE_NOT_PASSED` 同一条纪律：
 *   拒绝而不留痕，事后无法与「从未发生」区分。
 */
import { authorizeProposalRelease, type ProposalReleaseGateState } from "../../domain/skill/proposal-release-gate";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import { publishNewVersion, type PublishNewVersionResult } from "./publish-new-version";
import type { SecurityAuditPort, SkillVersionStorePort } from "./ports";

export interface ReleaseProposalInput {
  readonly proposalId: string;
  readonly skillId: string;
  readonly versionId: string;
  /** 发起本次释放调用的 principal——批准分支是审核人，绕过尝试分支是攻击者/误用者 */
  readonly principalId: string;
  readonly expectedHeadVersionId: string | null;
  readonly gate: ProposalReleaseGateState;
}

export type ReleaseProposalResult =
  | PublishNewVersionResult
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export async function releaseProposal(
  input: ReleaseProposalInput,
  deps: { readonly versions: SkillVersionStorePort; readonly audit: SecurityAuditPort },
): Promise<ReleaseProposalResult> {
  const verdict = authorizeProposalRelease(input.gate);

  if (!verdict.allowed) {
    if (verdict.code === "PROPOSAL_NOT_REVIEWED") {
      await deps.audit.record({
        kind: "skill-gate-bypass-attempt",
        principalId: input.principalId,
        detail: `proposal ${input.proposalId} on skill ${input.skillId} attempted release without an approved review`,
      });
    }
    return { ok: false, code: verdict.code, reason: verdict.reason };
  }

  return publishNewVersion(
    {
      skillId: input.skillId,
      versionId: input.versionId,
      expectedHeadVersionId: input.expectedHeadVersionId,
    },
    { versions: deps.versions },
  );
}
