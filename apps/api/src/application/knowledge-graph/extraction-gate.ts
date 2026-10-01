/**
 * Phase 18 S8（#4365）——「值得记」门控的应用层：规则（domain/knowledge-graph/worth-remembering.ts）+ 可选的便宜模型判一次。
 *
 * 顺序与方向（见 worth-remembering.ts 头注「宁可多抽，不可漏记」）：
 *   1. 规则判「受保护」（目标 / 偏好 / 决定 / 记忆指令）⇒ 直接放行，**不问模型**；
 *   2. 规则判「跳过」（寒暄 / 应答 / 纯提问）⇒ 跳过；
 *   3. 其余：便宜模型开着（`KG_EXTRACTION_GATE_MODEL=1`，默认关）⇒ 问一次「值不值得记」；明确回「不值得」才跳过。
 *      模型出错 / 回得不明确 ⇒ 记一条带错误码的 error 日志并计数，**照常抽取**——门控失败的安全方向是多抽一次，
 *      不是把这条消息丢掉（丢掉是不可恢复的）。
 *
 * 被跳过的消息：任务照常完成出队（不重试），记一条结构化日志 `kg extraction skipped: not worth remembering`
 * （reason = greeting / acknowledgement / pure_question / model_not_worth），并计入 SLO 记录器的「省下的调用」。
 * ⚠ 与 s4 的集成点：s4 正在加逐条消息的结果表（面板上「没有需要记的」淡提示，#4352）。这里不另建表；
 *   s4 落地后，在本函数返回 skip 的那一处（extract-message-knowledge.ts `extractJob` 的 gated 分支）写一行
 *   `skipped` + reason 即可——日志字段名与那张表的原因列一一对应。
 */
import type { LoggerPort } from "../ports/logger.port";
import { judgeWorthRemembering, type WorthProtection } from "../../domain/knowledge-graph/worth-remembering";
import type { ExtractionSloRecorder, GateSkipReason } from "./extraction-slo-recorder";
import type { KgExtractionJob, KgMessage } from "./ports";

/** 可选的便宜模型判定。true = 值得交给抽取模型；false = 明确不值得。拿不准时实现应返回 true。 */
export interface WorthinessModelPort {
  worthRemembering(input: { readonly message: KgMessage; readonly context: readonly KgMessage[] }): Promise<boolean>;
}

export type GateDecision =
  | { readonly gate: "extract"; readonly protectedBy: WorthProtection | null }
  | { readonly gate: "skip"; readonly reason: GateSkipReason };

export async function gateExtraction(
  deps: { readonly logger: LoggerPort; readonly slo?: ExtractionSloRecorder; readonly gateModel?: WorthinessModelPort },
  job: KgExtractionJob,
  loaded: { readonly message: KgMessage; readonly context: readonly KgMessage[] },
): Promise<GateDecision> {
  const verdict = judgeWorthRemembering(loaded.message.body);
  let decision: GateDecision = verdict.verdict === "skip"
    ? { gate: "skip", reason: verdict.reason }
    : { gate: "extract", protectedBy: verdict.protectedBy };
  if (decision.gate === "extract" && decision.protectedBy === null && deps.gateModel !== undefined) {
    try {
      const worth = await deps.gateModel.worthRemembering(loaded);
      deps.slo?.recordGateModelCheck(true);
      if (!worth) decision = { gate: "skip", reason: "model_not_worth" };
    } catch (err) {
      deps.slo?.recordGateModelCheck(false);
      deps.logger.error("kg extraction gate model failed; extracting anyway", {
        traceId: "kg-extraction", code: "KG_GATE_MODEL_FAILED", orgId: job.orgId, messageId: job.messageId, err,
      });
    }
  }
  if (decision.gate === "skip") {
    deps.slo?.recordGateSkip(decision.reason);
    deps.logger.info("kg extraction skipped: not worth remembering", {
      traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, threadId: job.threadId,
      reason: decision.reason, authorKind: loaded.message.authorKind, modelCallSaved: true,
    });
  }
  return decision;
}
