/**
 * Ports for RQ (research question) coverage state (F92, uc-6-4 R3 步骤7 / AC1).
 *
 * ## 为什么这是独立端口,不并进 `OutlineRepository`
 *
 * 提纲段落完成态（F90）与 RQ 覆盖度（F92）都遵循「只有人能写」的同一条纪律，
 * 但它们是两个独立的领域对象——一场访谈的提纲段落数与 RQ 数互不相关（原型固定
 * 5 个 RQ，段落数随大纲变化）,`endAndTranscribe`（结束并转写）读的是 RQ 覆盖表,
 * 不是提纲表。复用同一张表会让"提纲进度 3/6"与"RQ 覆盖 5 个"两件事纠缠在一行里。
 */
import type { OrgId } from "../../domain/org-id";
import type { RqCoverageRecord, RqCoverageValueName } from "../../domain/interview/rq-coverage";

export interface RqCoverageRepository {
  /** 按访谈取当前 5 个 RQ 的覆盖行（尚未打过状态的 RQ，`value` 为 `null`）。 */
  listByInterview(orgId: OrgId, interviewId: string): Promise<readonly RqCoverageRecord[]>;

  /**
   * F92 —— 人工写入单个 RQ 的覆盖态。
   * ⚠ 调用方（`setRqCoverageStatus`）已经拒绝了 `viewerActorKind === "agent"`，
   * 这个方法本身不重复判定来源，只管写。
   */
  setValue(
    orgId: OrgId,
    interviewId: string,
    rqId: string,
    value: RqCoverageValueName,
  ): Promise<RqCoverageRecord>;
}

export const RQ_COVERAGE_REPOSITORY = Symbol("RqCoverageRepository");
