/**
 * F54 (UC-21.2 R7 / R12 V1-V2a) -- 安全策略四开关：默认值、可关闭性判定.
 *
 * ## 这个文件只判定"这次改动允不允许"，不负责持久化或留痕
 *
 * 四条策略的**存在与默认值**、**哪些可关**是本用例的核心裁决（O-19），逐条：
 *
 * | # | 开关 | 默认 | 可关闭性 |
 * |---|---|---|---|
 * | 1 | 新服务器默认隔离 | 开 | 允许关，需二次确认（`confirmToken`） |
 * | 2 | 涉客户数据全量留痕 | 开 | 允许关，需二次确认（`confirmToken`） |
 * | 3 | 客户机密仅本地模型 | 开 | **不允许关，任何路径**（含直调 API） |
 * | 4 | agent 自行发现新 MCP | 关 | **phase-1 无打开入口**，直调 API 打开被拒 |
 *
 * ⚠ 契约已经把 3、4 的"不可变"焊死在类型层（`SecurityPolicy.confidentialLocalOnly:
 * z.literal(true)` / `agentSelfDiscoversMcp: z.literal(false)`）——那一层挡的是"往库里
 * 写一个非法值"。这个文件挡的是**更早一步**：一次"把开关 3 设为 false"的请求，在它有机会
 * 触及任何存储之前就要被识别并拒绝，而且拒绝理由必须是契约声明的 `POLICY_SWITCH_LOCKED`，
 * 不能是 zod 校验失败那种更难解释给管理员看的错误。
 *
 * ⚠ **默认保留期天数不是本文件的常量**——见下方 `defaultProvenanceRetentionDays`，
 * 它转手引用 `AUTH_POLICY.orgRetentionDays`（O-01 的单一事实源，`packages/contracts/
 * src/auth.ts`），不在这里另开一份 `180`。一处配置、多处消费（R7 逐字）。
 */
import { AUTH_POLICY } from "@repo/contracts/auth";
import type { SecurityPolicy } from "@repo/contracts/agent-runtime";
import type { z } from "zod";

export type SecurityPolicyT = z.infer<typeof SecurityPolicy>;

/**
 * O-01 的默认值，**借用**而非重开一份 180。项目级覆盖（O-01 允许）由调用方在读取组织
 * 参数时决定是否覆盖这个默认——本文件不知道"项目"这个概念，只知道"没有更具体的值时用它"。
 */
export const defaultProvenanceRetentionDays = (): number => AUTH_POLICY.orgRetentionDays;

/**
 * 新组织初始化后的安全策略（V1：默认值「开/开/开/关」）。
 * ⚠ `confidentialLocalOnly`/`agentSelfDiscoversMcp` 的类型本身就只能是 `true`/`false`
 *   ——这里赋的不是"选择"，是把契约里唯一合法的值填进去。
 */
export function defaultSecurityPolicy(): SecurityPolicyT {
  return {
    isolateNewServers: true,
    logCustomerDataCalls: true,
    confidentialLocalOnly: true,
    agentSelfDiscoversMcp: false,
    provenanceRetentionDays: defaultProvenanceRetentionDays(),
  };
}

export type PolicySwitchNo = 1 | 2 | 3 | 4;

export type SwitchChangeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "POLICY_SWITCH_LOCKED"; readonly detail: string };

/**
 * 🔴 V2a 的判定纯函数——四条开关各自的可关闭性规则，**服务端强制而非展示**（R7）。
 *
 * ⚠ 开关 1/2：打开(`enabled: true`)恒允许、不需要确认——只有**关闭**是高影响动作。
 *   关闭时缺 `confirmToken` ⇒ 拒绝，理由仍是 `POLICY_SWITCH_LOCKED`（契约只声明了这一个码，
 *   见 `agent-runtime.ts` `setSecurityPolicy` 的 err 列表；"未二次确认"与"结构性不可变"
 *   共用同一个码，前端据 `detail` 文案区分，而不是新造第二个码去分裂同一个业务概念——
 *   "这次开关变更现在不能生效"）。
 * ⚠ 开关 3：**任何** `enabled` 取值只要不是 `true` 就锁死；即便带着 `confirmToken`
 *   也不放行——它不是"确认力度不够"，是"这条门根本没有二次确认这一说"。
 * ⚠ 开关 4：**任何** `enabled: true` 尝试都锁死，不看 `confirmToken`——phase-1 没有打开
 *   入口，"提供但恒拒"与"不提供"在对外行为上一致，但契约选择用同一个码统一表达。
 */
export function evaluateSecurityPolicySwitchChange(input: {
  readonly switchNo: PolicySwitchNo;
  readonly enabled: boolean;
  readonly hasConfirmToken: boolean;
}): SwitchChangeResult {
  switch (input.switchNo) {
    case 1:
    case 2:
      if (input.enabled) return { ok: true };
      if (!input.hasConfirmToken) {
        return {
          ok: false,
          reason: "POLICY_SWITCH_LOCKED",
          detail: `开关 ${input.switchNo} 关闭需组织管理员二次确认（confirmToken 缺失）`,
        };
      }
      return { ok: true };
    case 3:
      if (input.enabled) return { ok: true };
      return {
        ok: false,
        reason: "POLICY_SWITCH_LOCKED",
        detail: "开关 3（客户机密仅本地模型）任何路径都无法关闭——只读常开",
      };
    case 4:
      if (!input.enabled) return { ok: true };
      return {
        ok: false,
        reason: "POLICY_SWITCH_LOCKED",
        detail: "开关 4（agent 自行发现新 MCP）phase-1 不提供打开能力——只读常关",
      };
  }
}

/** "关掉会发生什么" 的后果说明（R8 推荐交互）——文案随此表维护，不在界面层另写一份。 */
export const SWITCH_CLOSABLE_CONSEQUENCE: Readonly<Record<PolicySwitchNo, string>> = {
  1: "此后新注册的 MCP 将立即可用，不经评审。",
  2: "涉客户数据的工具调用将不再留痕，无法追溯谁调用过什么。",
  3: "（不可关闭）关掉即意味着客户机密材料可能被闭源云端模型处理。",
  4: "（不可开启）AI 将可自行接入未经评审的外部能力源。",
};
