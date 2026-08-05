/**
 * `runSecurityScan` —— 门禁**第一道**的用例（#552；契约 `runSecurityScan`，UC-3.1 R3 步骤 3）。
 *
 * 在这个文件之前，`GateState.scan` 在全仓恒为 `null`，而 `null` 的语义是「还没扫过」，
 * 于是 `gatesAllowEnable` 对任何调用方都返回 `GATE_NOT_PASSED` —— 双重门禁的第一道
 * **有判定、没有生产者**。本用例是那个生产者。
 *
 * ## 判拒也落库
 *
 * `verdict === "reject"` 时本用例返回 `ok: false`，但**记录照写**。理由在
 * `declarative-scan.ts` 末尾：「扫过并被拒」与「从未扫过」在数据上必须可分辨，
 * 否则 I-3 的倒查两者都读成 `null`，而后者意味着这个版本从来没进过门禁。
 *
 * ## ⚠ 上界现取，不复用建草稿时的那一次
 *
 * `SubmitterGrantsPort` 在这里被**重新问一次**。E6 要求「操作过程中权限被撤回时立即终止
 * 后续写操作」，而建草稿与提交评审之间可以隔任意长的时间。复用建草稿时的结论，
 * 等于让一个已被撤权的人靠一份旧快照过门。
 */
import { scanDeclarativeContract } from "../../domain/skill/declarative-scan";
import type { SecurityScanResult } from "../../domain/skill/security-gate";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type {
  SecurityScanStorePort,
  SkillVersionLifecyclePort,
  SubmitterGrantsPort,
} from "./ports";

export interface RunSecurityScanInput {
  readonly versionId: string;
  /** 已由 Guard 认证过的调用者；写进扫描记录的 `scanned_by`。 */
  readonly principalId: string;
  /** 扫描记录 id。由调用方生成（测试给可预期的值），本用例不碰 uuid。 */
  readonly scanId: string;
}

export type RunSecurityScanResult =
  | { readonly ok: true; readonly result: SecurityScanResult }
  | {
      readonly ok: false;
      readonly code: SkillErrorCode;
      readonly reason: string;
      /** ⚠ 判拒时**仍然**带回结论：界面要逐条列出 findings，而不是只说「被拒了」。 */
      readonly result: SecurityScanResult | null;
    };

export interface RunSecurityScanDeps {
  readonly versions: SkillVersionLifecyclePort;
  readonly scans: SecurityScanStorePort;
  readonly grants: SubmitterGrantsPort;
}

export async function runSecurityScan(
  input: RunSecurityScanInput,
  deps: RunSecurityScanDeps,
): Promise<RunSecurityScanResult> {
  const version = await deps.versions.loadVersionForReview(input.versionId);
  if (version === null) {
    return {
      ok: false,
      code: "SKILL_NOT_FOUND",
      reason: "版本不存在或不在本租户内",
      result: null,
    };
  }

  // ⚠ 上界属于**提交人**，不是发起扫描的人：I-12 判的是「这份声明有没有超出提交人的权限」，
  //   换成扫描发起人会让一个高权限的人替低权限的提交人把越权声明扫过去。
  const submitterGrants = await deps.grants.grantsOf(version.submitterId);

  const result = scanDeclarativeContract(version.versionId, {
    contract: version.contract,
    submitterGrants: submitterGrants as readonly string[],
  });

  await deps.scans.saveScan({
    scanId: input.scanId,
    skillId: version.skillId,
    versionId: version.versionId,
    result,
    scannedBy: input.principalId,
  });

  if (result.verdict === "reject") {
    return {
      ok: false,
      code: "SECURITY_SCAN_REJECTED",
      reason: `安全扫描判拒，风险项 ${result.findings.length} 条：${result.findings
        .map((f) => f.kind)
        .join("、")}`,
      result,
    };
  }

  return { ok: true, result };
}
