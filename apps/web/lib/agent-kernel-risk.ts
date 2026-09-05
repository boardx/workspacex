/**
 * issue #2767 —— 工具风险等级（L0/L1/L2）的展示文案，单一事实源。
 *
 * 搬出理由与 `components/agent-kernel/interjection-composer.tsx`/`tool-permission-
 * card.tsx` 头注同一条：`tests/session/chat-dead-mock-cluster.test.ts`（#462）机械
 * 禁止 `/chat` 路由闭包里出现任何指向 `lib/mock/**` 的边。这份记录此前只活在
 * `lib/mock/agent-kernel.ts`（`/preview/agent-kernel` 签核原型用的 mock 数据文件），
 * `chat-host-tool-permission.tsx` 要在真实 `/chat` 里渲染同一份风险徽标，就不能再
 * 经过那个文件。`lib/mock/agent-kernel.ts` 的 `TodoRisk`/`RISK_LABEL` 改成从这里
 * 重新导出（既有 import 路径不变），不是复制一份——同一份文案只声明一次。
 *
 * ⚠ `ToolRiskLevel` 本身不是这里的事实源：契约单源在
 * `packages/contracts/src/plan-permissions.ts`（`lint-contract-source.mjs` 机械断言，
 * ADR-020），这里必须从那里 `z.infer` 出来，不能另起一份字面量同名类型——同一件事声明
 * 两处必然漂移。
 */
import { planPermissions as C } from "@repo/contracts";

export type ToolRiskLevel = C.ToolRiskLevel;

export const RISK_LABEL: Record<ToolRiskLevel, { readonly text: string; readonly hint: string }> = {
  L0: { text: "只读", hint: "无副作用，自动执行" },
  L1: { text: "可撤销", hint: "写/改文件，有版本历史可回滚，自动执行但带 diff" },
  L2: { text: "高风险", hint: "不可逆或外发，执行前需你确认" },
};
