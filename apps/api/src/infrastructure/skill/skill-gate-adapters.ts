/**
 * #459 —— `createSkillDraft` / `disableSkill` 需要、但**本波次没有真实数据源**的两个端口。
 *
 * 这个文件存在的唯一理由是：**不在 controller 里写内联 lambda**。
 * `{ grantsOf: async () => [] }` 与 `{ record: async () => undefined }` 写在调用点上，
 * 读起来像「这里不重要」，而它们其实各自压着一条产品规则（I-12 的权限上界、
 * I-23 的绕过留痕）。做成有名字、有注释、可被 grep 到的类，缺口才是可见的。
 *
 * ⚠ 两者都**不是** fallback：一个 fail closed（拒绝），一个真的把事件写出去（结构化日志）。
 *   没有任何一条路径会因为「数据源缺失」而**放行**。
 */
import type { LoggerPort } from "../../application/ports/logger.port";
import type { DataScopeKey } from "../../domain/skill/data-scope";
import type { SecurityAuditPort, SubmitterGrantsPort } from "../../application/skill/ports";

/**
 * 提交人持有的数据范围（I-12 的上界）。
 *
 * ## ⚠ 已上报的契约缺口：`DataScopeKey` 没有取值集合，也没有归属
 *
 * `domain/skill/data-scope.ts` 逐字写着这个键集**不属于本域**
 * （「它属 identity / context-pack 束……本域只做集合运算与拒绝理由」），
 * 而 identity 束今天**没有**任何解析「某人持有哪些数据范围」的端口或表。
 * 也就是说：这条链的上界在全仓没有事实源。
 *
 * ## 本实现的处置：fail closed，不是 fallback
 *
 * 恒返回空集 ⇒ 任何**非空**的 `dataScope` 声明都会被
 * `checkDataScopeWithinSubmitter` 判成 `DATA_SCOPE_EXCEEDS_SUBMITTER`，
 * 声明 `readsRawTranscript` 会被判成 `RAW_TRANSCRIPT_NOT_AUTHORIZED`。
 * 于是本波次只建得出**不申请任何数据范围**的 skill。
 *
 * ⚠ 反过来做（缺数据源时默认「什么都有」）会让越权声明一路进到待审核队列，
 *   而 `usecases.md` 点名了这个后果：审核人看到的是一份「已过校验」的待审项，
 *   于是他替提交人背了这个书。少建几个 skill 是可恢复的，那个不是。
 */
export class FailClosedSubmitterGrants implements SubmitterGrantsPort {
  async grantsOf(_principalId: string): Promise<readonly DataScopeKey[]> {
    return [];
  }
}

/**
 * 安全审计（I-23：绕过尝试**必须留痕**——一次没有留痕的拒绝，事后与「从未发生」不可区分）。
 *
 * ## ⚠ 已上报的缺口：全仓没有持久化审计表
 *
 * `apps/api/src/infrastructure/` 下没有任何 audit 写入器，migrations 里也没有一张
 * 供应用层写安全事件的表。本实现把事件写进**结构化日志**：它是可观察的、带
 * `traceId` 可关联的，但**不可查询**——「上个月谁试过绕门禁」这种问题答不了。
 *
 * 补一张表属于跨束的可观测性基建（`.harness/instructions/observability.md`），
 * 不在 #459 范围内，已作为缺口上报，**不在这里顺手建一张只有 skill 用的审计表**
 * ——那会成为第二个事实源。
 */
export class LoggingSkillSecurityAudit implements SecurityAuditPort {
  constructor(private readonly logger: LoggerPort) {}

  async record(event: {
    readonly kind:
      | "skill-gate-bypass-attempt"
      | "skill-source-tag-write-attempt"
      | "skill-member-self-mount-attempt"
      | "skill-ai-self-promotion-attempt";
    readonly principalId: string;
    readonly detail: string;
  }): Promise<void> {
    this.logger.info("skill.security-audit", {
      // 本端口没有请求上下文，拿不到本次请求的 traceId。写一个明确的哨兵值，
      // 而不是编一个随机 id——后者看起来像能关联，实际上关联不到任何东西。
      traceId: "skill-security-audit",
      auditKind: event.kind,
      principalId: event.principalId,
      detail: event.detail,
    });
  }
}
