/**
 * `files` 束的两个出站端口 —— **phase-01 契约先行桩**（F47）
 *
 * 契约本身在 `files.ts` 的 `OUTBOUND_PORTS`（**唯一事实源**）；本文件只有两样东西：
 *   ① 桩实现（phase-02 的 09-kg / 10-report 到位前，调用它会发生什么）
 *   ② `PHASE_02_OUT_OF_SCOPE` —— **本 feature 明确不做的部分，具名登记**
 *
 * ## 桩为什么不是 `throw new Error("not implemented")`
 * 那种桩对调用方是**不可分辨的崩溃**：`requestDeletion` 的六类级联编排拿到它，
 * 只能记一个「未知异常」，于是「09-kg 还没上线」与「09-kg 挂了」在删除回执上长得一样。
 * ⇒ 桩抛的是契约**已声明的失败**：`CASCADE_TARGET_UNAVAILABLE`，带上是哪个端口、
 *   谁该提供、属哪个阶段。级联编排据此把第 ⑤ 项记 `failed`，
 *   于是 `DELETION_PARTIAL_FAILURE` 成立、**不出回执**（N-17）——
 *   这正是本仓的「宁可红，不可假绿」：接口没实现时，删除**如实地不完成**。
 *
 * ## 🔴 桩绝不返回成功
 * 一个返回 `{ invalidatedEdgeIds: [] }` 的桩会让六类级联第 ⑤ 项记 `ok`、回执照出，
 * 而边还在图里。**那是本 UC 最危险的缺陷形状的完美复刻**，
 * 且它与真实的「本来就没有相关边」逐字节相同（`files.KNOWN_CONTRACT_GAPS.FS13`）。
 */
import { z } from "zod";
import { OUTBOUND_PORTS, type OutboundPortName } from "./files";

/**
 * 出站端口的调用签名。**契约面的形状由 `OUTBOUND_PORTS[port].in/out` 说了算**，
 * 这里只说「它是一个可能失败的异步调用」。
 *
 * ⚠ 泛型刻意用 `unknown`：契约测试**不得**依赖某个具体实现的类型，
 *   否则「换成真实现契约不变」这句话就没法验——它会在编译期就绑死。
 */
export type OutboundPortImpl = (input: unknown) => Promise<unknown>;

/**
 * 端口不可用。**这是契约声明过的失败**，不是一次意外。
 *
 * ⚠ `code` 是 `files.FilesError` 的成员 `CASCADE_TARGET_UNAVAILABLE`；
 *   `port` 让调用方知道**是哪一类**没完成（`usecases.md`：须标出哪一类未完成）。
 */
export class CascadeTargetUnavailableError extends Error {
  readonly code = "CASCADE_TARGET_UNAVAILABLE" as const;
  constructor(
    readonly port: OutboundPortName,
    readonly providedBy: string,
  ) {
    super(`outbound port \`${port}\` is not implemented in phase-01; provided by ${providedBy}`);
    this.name = "CascadeTargetUnavailableError";
  }
}

/**
 * 入参不合契约。**与端口不可用分开**——前者是调用方的 bug，后者是外部依赖缺席。
 * 合并会让「级联编排传了个空集」看起来像「09-kg 没上线」。
 */
export class PortInputInvalidError extends Error {
  readonly code = "PORT_INPUT_INVALID" as const;
  constructor(
    readonly port: OutboundPortName,
    readonly issues: readonly string[],
  ) {
    super(`invalid input for outbound port \`${port}\`: ${issues.join("; ")}`);
    this.name = "PortInputInvalidError";
  }
}

/** 入参校验：任何实现（桩或真实现）都先过这一道。`in` 是 strict 的，多一个键就红 */
export function assertPortInput(port: OutboundPortName, input: unknown): void {
  const schema = OUTBOUND_PORTS[port].in as z.ZodTypeAny;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PortInputInvalidError(port, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
}

/**
 * phase-01 的桩实现。
 *
 * ⚠ **幂等**：它没有状态，同样的入参必然得到同样的结果——
 *   这一条被契约测试断言，因为「重试级联」（`retryCascade`）依赖它。
 * ⚠ 校验**先于**不可用：入参错了就该报入参错，
 *   否则实现方上线那天，一批本来就该红的调用会从 `CASCADE_TARGET_UNAVAILABLE`
 *   突然变成 `PORT_INPUT_INVALID`，看起来像新 bug。
 */
export function createPhase01Stub(port: OutboundPortName): OutboundPortImpl {
  const { providedBy } = OUTBOUND_PORTS[port];
  return async (input: unknown) => {
    assertPortInput(port, input);
    throw new CascadeTargetUnavailableError(port, providedBy);
  };
}

/** 两个桩的成品。⚠ 名字从 `OUTBOUND_PORTS` 派生，不另抄一份 */
export const phase01OutboundStubs: Record<OutboundPortName, OutboundPortImpl> = {
  invalidateOntologyEdges: createPhase01Stub("invalidateOntologyEdges"),
  annotateWithdrawnEvidence: createPhase01Stub("annotateWithdrawnEvidence"),
};

/**
 * 🔴 **本 feature 明确不做的部分，具名登记。**
 *
 * 「桩 feature」最容易变成的东西是一个什么都不验的空壳，加一句「实现在下一阶段」。
 * 那句话写在提交信息里就没人看得见了。⇒ 逐条写在这里，
 * 并由 `tests/files/outbound-port-conformance.ts` 断言这张表**非空且每条都指名端口**。
 */
export const PHASE_02_OUT_OF_SCOPE = {
  /** 09-kg 侧：怎么找到「相关边」、置 `status=invalidated` 的写事务、边的孤立节点回收 */
  KG_EDGE_INVALIDATION_BODY:
    "09-kg (phase-02) owns: which edges count as related, the write transaction setting status=invalidated, and orphan-node reclamation (uc-17-2 line 99). F47 defines only the call shape",
  /** 10-report / 13-deliv 侧：段落标注的落库、对内可见性、通知拍板人的投递 */
  REPORT_SEGMENT_ANNOTATION_BODY:
    "10-report / 13-deliv (phase-02) owns: persisting the 「证据已撤回」 annotation, its internal-only visibility, and delivering the approver notification. D-19's 「对外不自动改写，需人工确认后替换」 is a downstream workflow, not part of this port",
  /** 与 phase-00 `artifact.markEvidenceWithdrawn` 是不是同一个操作 —— 一致性复核裁 */
  DUPLICATE_WITH_MARK_EVIDENCE_WITHDRAWN:
    "coverage C-3 / files.KNOWN_CONTRACT_GAPS.FS11: annotateWithdrawnEvidence and the SIGNED artifact.markEvidenceWithdrawn are shape-alike. F47 does NOT rule whether they are the same operation — ruling it would either delete a signed operation or create the N-th duplicate fact. Left红, not silently merged",
  /** `out` 分不清「没有相关边」与「没干活」 —— 见 FS13，不在此发明字段 */
  EMPTY_RESULT_AMBIGUITY:
    "files.KNOWN_CONTRACT_GAPS.FS13: an empty result set is indistinguishable from a no-op. Resolving it means adding a field to 09-kg's response shape, which is phase-02's design",
  /** 六类级联编排本体（`CascadeInvalidator`）属 T86/F46，不是本 feature */
  CASCADE_ORCHESTRATION:
    "the CascadeInvalidator that calls these ports and maps failures onto DELETION_PARTIAL_FAILURE belongs to F45 (phase-01 deletion propagation, uc-22-4 T86), not to F47",
} as const;

/** 每条登记都必须指名一个端口或一个已登记的缺口编号——由契约测试断言 */
export const PHASE_02_OUT_OF_SCOPE_KEYS = Object.keys(PHASE_02_OUT_OF_SCOPE) as (keyof typeof PHASE_02_OUT_OF_SCOPE)[];
