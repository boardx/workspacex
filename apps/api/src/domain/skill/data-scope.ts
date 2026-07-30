/**
 * **数据范围越权检查**（F61；`contracts/skills/domain.md` I-12 / I-24、UC-3.1 R3 步骤 2 与 E1）。
 *
 * 一句话规格（domain.md `DataScopeDeclaration`）：**声明本身不构成授权**。
 *
 *   有效数据范围 ＝ 声明范围 ∩ agent 工具白名单 ∩ MCP 授权范围
 *                  ∩ 当次任务权限包 ∩ **Context Pack 实际返回项**
 *
 * 本文件负责这条链的**两端**，中间三项属别的束（identity / agent-runtime / 21-mcp）：
 *   · 提交时：声明范围 ⊆ **提交人当时的权限**（I-12，提交人权限是上界）；
 *   · 运行时：有效范围 ＝ 声明范围 ∩ **Context Pack 实际返回项**（I-24）。
 *
 * ⚠ 越权**直接判失败、不进待审核队列**（E1 / UC-3.1 V6）。理由写在 usecases.md 上：
 *   放进队列，审核人就会替提交人背这个书——他看到的是一份「已过校验」的待审项。
 */
import type { SkillErrorCode } from "./declarative-contract";

/**
 * 数据范围键。**不定义取值集合**：它属 identity / context-pack 束
 * （domain.md 第四节「这个域不负责什么」逐字：鉴权判定本身属 phase-00 identity 束）。
 * 本域只做集合运算与拒绝理由，不判断某个键是否存在。
 */
export type DataScopeKey = string;

/**
 * 「读原始转写」的范围键。
 *
 * 它在契约 `DeclarativeContract` 里是一个**独立的布尔字段** `readsRawTranscript`，
 * 而不是 `dataScope` 数组里的一项——因为 E1 给它单列了失败码
 * （`RAW_TRANSCRIPT_NOT_AUTHORIZED`，usecases.md：「`DATA_SCOPE_EXCEEDS_SUBMITTER`
 * 的具名子类，因界面文案不同故单列」）。这里给出它在授权集合里的键名，
 * 好让「提交人有没有这项授权」与别的范围用同一套判定。
 */
export const RAW_TRANSCRIPT_SCOPE: DataScopeKey = "raw-transcript:read";

export interface DataScopeCheckInput {
  /** 契约里声明的范围 */
  readonly declared: readonly DataScopeKey[];
  /** 契约里的 `readsRawTranscript` */
  readonly readsRawTranscript: boolean;
  /** **提交人当时**持有的范围（上界）。⚠ 由 identity 束解析，本域只消费 */
  readonly submitterGrants: readonly DataScopeKey[];
}

export interface DataScopeCheckResult {
  readonly ok: boolean;
  readonly code: SkillErrorCode | null;
  /** 越出上界的项，**逐条**。界面要按项给「申请授权」入口，一句汇总话做不到 */
  readonly exceeded: readonly DataScopeKey[];
  /** ⚠ 「说得出理由」是验收判据的一部分（F61），不是调试信息 */
  readonly reason: string | null;
  /**
   * 越权 ⇒ **false**。
   * 显式返回而不是让调用方从 `ok` 推：E1 要求的是「不进待审核队列」这个**行为**，
   * 把它写成字段，`scope-not-exceed-submitter.test.ts` 才能直接断言它。
   */
  readonly mayEnterReviewQueue: boolean;
}

/**
 * 提交时的越权检查。**纯函数**。
 *
 * ⚠ 先判 `RAW_TRANSCRIPT_NOT_AUTHORIZED` 再判一般越权：两码不是并列关系，
 *   前者是后者的具名子类，同时命中时界面该显示的是那句更具体的
 *   （「需先取得原始转写授权」，而不是「有 N 项越权」）。
 */
export function checkDataScopeWithinSubmitter(input: DataScopeCheckInput): DataScopeCheckResult {
  const grants = new Set(input.submitterGrants);

  if (input.readsRawTranscript && !grants.has(RAW_TRANSCRIPT_SCOPE)) {
    return {
      ok: false,
      code: "RAW_TRANSCRIPT_NOT_AUTHORIZED",
      exceeded: [RAW_TRANSCRIPT_SCOPE],
      reason:
        "契约声明读原始转写，但提交人当前不持有原始转写授权；需先取得授权（UC-3.1 E1）",
      mayEnterReviewQueue: false,
    };
  }

  const exceeded = input.declared.filter((k) => !grants.has(k));
  if (exceeded.length > 0) {
    return {
      ok: false,
      code: "DATA_SCOPE_EXCEEDS_SUBMITTER",
      exceeded,
      reason: `数据范围越出提交人当前权限，越权项：${exceeded.join("、")}；提交人权限是上界（I-12）`,
      mayEnterReviewQueue: false,
    };
  }

  return { ok: true, code: null, exceeded: [], reason: null, mayEnterReviewQueue: true };
}

/**
 * 运行时的**有效**数据范围（I-24 后半句）。
 *
 * ⚠ 这里是**交集**，不是「声明了就能读」：Context Pack 没返回的项，声明里有也读不到。
 *   反过来，Context Pack 返回了但声明里没有的项**也不在有效范围内**——
 *   否则一次装配得慷慨的检索就成了越权通道。
 */
export function effectiveDataScope(
  declared: readonly DataScopeKey[],
  contextPackReturned: readonly DataScopeKey[],
): readonly DataScopeKey[] {
  const returned = new Set(contextPackReturned);
  return declared.filter((k) => returned.has(k));
}

/**
 * 越出有效范围的取数请求：拒，**并说出理由**。
 *
 * F61 的验收判据逐字「越出声明范围的取数被拒**且说得出理由**」。
 * 所以返回的不是 boolean：一个只会说「拒绝」的守卫，事故复盘时什么都留不下。
 */
export function authorizeScopeRead(input: {
  readonly requested: DataScopeKey;
  readonly declared: readonly DataScopeKey[];
  readonly contextPackReturned: readonly DataScopeKey[];
}): { readonly allowed: boolean; readonly reason: string } {
  const inDeclared = input.declared.includes(input.requested);
  const inPack = input.contextPackReturned.includes(input.requested);

  if (inDeclared && inPack) {
    return { allowed: true, reason: `${input.requested} 同时在声明范围与 Context Pack 返回项内` };
  }
  if (!inDeclared) {
    return {
      allowed: false,
      reason: `${input.requested} 不在该 skill 的声明数据范围内（声明范围：${input.declared.join("、") || "空"}）`,
    };
  }
  return {
    allowed: false,
    reason: `${input.requested} 已声明但本次 Context Pack 未返回；有效范围 ＝ 声明范围 ∩ Context Pack 实际返回项（I-24）`,
  };
}
