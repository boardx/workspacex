/**
 * EV03 门脚本 `lint-work-stack-gates` 的常量（04-eval-gates R3.5 / R7「阈值等数值只在门脚本常量一处声明」）。
 *
 * 判定逻辑在 `application/work-eval/work-stack-gates.ts`（纯函数），IO 在
 * `infrastructure/work-eval/fs-work-stack-gates.ts`。本文件只放「登记表」类事实，纯数据。
 */
import { REGISTERED_CAPABILITY_CATEGORY_SET } from "../skill/capability-category-registry";

/** `WorkGateStatus.scriptVersion`：判定规则变化时 bump（回写记录据此追溯）。 */
export const WORK_STACK_GATES_SCRIPT_VERSION = "lint-work-stack-gates-1.0.2";

/**
 * ADR-120 能力分类登记表（G3）。**不在这里声明**：唯一一份在 `domain/skill/capability-category-registry.ts`
 * （导入校验 WS02 E6 与就绪性 WS04 读的也是它）。此前这里另抄了一份更短的表，G3 与导入判据因此漂移
 * （导入放行的 `sandbox.exec` 在 G3 被判 CAPABILITY_UNREGISTERED）——同一事实不得声明在两处。
 */
export const REGISTERED_CAPABILITY_CATEGORIES: ReadonlySet<string> = REGISTERED_CAPABILITY_CATEGORY_SET;

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
