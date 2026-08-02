/**
 * `setRqCoverageStatus` —— 研究问题（RQ）五态覆盖度人工打分（F92，uc-6-4 R3 步骤7，AC1/AC2）。
 *
 * ## 服务端拒绝 `origin: ai` 的覆盖态写入——判据不是请求体里的自称
 *
 * 与 F90 `setOutlineSectionStatus` 同一立场：契约 `setRqCoverage.in` 里没有
 * `origin`/`writerOrigin` 字段——一个愿意写代码的客户端可以在请求体里填任何它
 * 想要的值，所以「谁在写」不能由请求体决定。判据是 `viewerActorKind`，一个只能
 * 由**调用方**（HTTP 层身份中间件，或记录 agent Echo 的服务端适配层）设置的字段。
 *
 * ## `not_applicable` 是独立第四态，不是 `uncovered` 的别名
 *
 * 见 `domain/interview/rq-coverage.ts` 头注：`not_applicable`（不适用本人）标记
 * 「这个 RQ 本就不该问这位受访者」，与「该问、还没问到」的 `uncovered` 在下游
 * 统计（`summarizeRqCoverage`）与 UC-6.5 证据矩阵解读上都必须区分——本用例对
 * 四个取值一视同仁地允许人工写入，不额外收窄这个类型。
 *
 * ## AI 只能提示，不能写
 *
 * issue 原文「AI 给建议，人定状态」——AI 侧【覆盖】提示卡（如 `RQ4 还没碰 · 剩 25 分`）
 * 是一个纯展示态（前端渲染，不经过这个用例的任何写路径）；本用例是唯一的写入口，
 * 且这个写入口对 `viewerActorKind === "agent"` 恒拒绝。没有第二个写路径能绕开它，
 * 因为 `RqCoverageRepository.setValue` 除了这个用例没有别的调用方。
 */
import type { OrgId } from "../../domain/org-id";
import type { RqCoverageValueName } from "../../domain/interview/rq-coverage";
import { RqCoverageAiWriteForbiddenError, RqCoverageConcurrentModificationError } from "./errors";
import type { RqCoverageRepository } from "./rq-coverage-ports";

export interface SetRqCoverageStatusDeps {
  readonly rqCoverage: RqCoverageRepository;
}

export interface SetRqCoverageStatusCommand {
  readonly orgId: OrgId;
  readonly interviewId: string;
  readonly rqId: string;
  readonly value: RqCoverageValueName;
  /**
   * ⚠ 由调用方（HTTP 层身份中间件 / 记录 agent 适配层）判定，不接受请求体自称。
   * 见文件头「服务端拒绝 origin: ai 的覆盖态写入」一节。
   */
  readonly viewerActorKind: "human" | "agent";
}

export interface SetRqCoverageStatusResult {
  readonly rqId: string;
  readonly value: RqCoverageValueName;
  /** 契约里这个字段恒为字面量 `"human"`——走到这里说明门禁已经通过。 */
  readonly writerOrigin: "human";
}

export async function setRqCoverageStatus(
  deps: SetRqCoverageStatusDeps,
  cmd: SetRqCoverageStatusCommand,
): Promise<SetRqCoverageStatusResult> {
  // 门禁在任何存在性查询之前——一个 agent 主体不该能靠「这个 RQ 存不存在」的
  // 不同拒绝，反推出这场访谈的 RQ 清单长什么样（与 `set-outline-section-status.ts`
  // 权限先于存在性判断同一条纪律）。
  if (cmd.viewerActorKind === "agent") {
    throw new RqCoverageAiWriteForbiddenError(cmd.rqId);
  }

  const current = await deps.rqCoverage.listByInterview(cmd.orgId, cmd.interviewId);
  const exists = current.some((r) => r.rqId === cmd.rqId);
  if (!exists) {
    throw new RqCoverageConcurrentModificationError(cmd.interviewId, cmd.rqId);
  }

  const updated = await deps.rqCoverage.setValue(cmd.orgId, cmd.interviewId, cmd.rqId, cmd.value);

  return {
    rqId: cmd.rqId,
    // updated.value 一定非 null：刚写完；cmd.value 只是兜底。
    value: (updated.value ?? cmd.value) as RqCoverageValueName,
    writerOrigin: "human",
  };
}
