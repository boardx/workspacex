/**
 * EV03 门脚本 `lint-work-stack-gates` 的常量（04-eval-gates R3.5 / R7「阈值等数值只在门脚本常量一处声明」）。
 *
 * 判定逻辑在 `application/work-eval/work-stack-gates.ts`（纯函数），IO 在
 * `infrastructure/work-eval/fs-work-stack-gates.ts`。本文件只放「登记表」类事实，纯数据、零依赖。
 */

/** `WorkGateStatus.scriptVersion`：判定规则变化时 bump（回写记录据此追溯）。 */
export const WORK_STACK_GATES_SCRIPT_VERSION = "lint-work-stack-gates-1.0.0";

/**
 * ADR-120 能力分类登记表（G3）。这是仓内**唯一**一份登记表：导入校验（WS02 E6）与就绪性（WS04）
 * 须 import 本常量，不得另抄一份（同一事实不得声明在两处）。
 * 取值来自第一阶段实体文档 §7 依赖节与 ADR-120 正文示例；新增分类只在此处追加。
 */
export const REGISTERED_CAPABILITY_CATEGORIES: ReadonlySet<string> = new Set([
  "knowledge.search",
  "knowledge.read",
  "knowledge.graph.read",
  "project.read",
  "chat.search",
  "mail.search",
  "mail.send",
  "tracker.read",
  "crm.read",
  "crm.write",
  "notify.inapp",
]);

/**
 * G1 许可：fair-code / source-available / 未声明许可证（PROP-WORK-STACK-001 风险表：「默认只作参考」）。
 * 这些许可证下的上游只允许 `strategy=reference-only` 且 `copied=false`；其余用法判 LICENSE_DISALLOWED。
 * 比较时忽略大小写。
 */
export const REFERENCE_ONLY_LICENSES: ReadonlySet<string> = new Set(
  [
    "Sustainable-Use-1.0", // n8n fair-code
    "LicenseRef-n8n-Sustainable-Use",
    "SSPL-1.0",
    "BUSL-1.1",
    "Elastic-2.0",
    "Commons-Clause",
    "LicenseRef-Onyx-Enterprise",
    "NOASSERTION",
    "UNKNOWN",
    "PROPRIETARY",
  ].map(l => l.toLowerCase()),
);
