/**
 * 批准闸门 —— 产品的信任核心（F112 · uc-8-2 · chat 束 domain.md E 组）。
 *
 * 纯函数，无 I/O：给定输入即可回答「六项披露是否齐全」「这组模型是否违反 D-U1」
 * 「这次预算折算多少钱」。应用层（`create-approval-request.ts` / `decide-approval.ts`）
 * 负责取数（model registry / 仓储）与落痕，本文件不做。
 *
 * ## I-32 的口径 —— 本文件采纳的是哪一个（🔴 domain.md 标注待裁，这里记下取的哪边）
 *
 * `contracts/chat/domain.md` I-32 明确标注这条不变量在两个口径下写法不同、裁决前不得
 * 据其写死断言：
 *   ① D-U1／`feature_list.json`：含机密 ⇒ **整轮**模型集合全部本地，云端本轮**不可用**；
 *   ② 原型 `ui-preview/README.md` S-01 的字面矛盾读法：机密只路由本地、云端可并存承接非机密。
 *
 * 本文件取 **①**，理由不是本文件自己拍板，而是**已有先例**：
 * `apps/api/src/domain/model/route-call.ts`（F51 `decideModelRoute`，已合入）对
 * "含机密但请求的模型不是 self-hosted" 判的是 `CONFIDENTIAL_ROUTE_VIOLATION`——
 * 一次拒绝，不是"云端处理非机密部分、本地处理机密部分"的部分放行。
 * `modelPolicyViolation` 在这里复述**同一个判据**（"有机密 ⇒ 集合里不能有云端"），
 * 不是发明第二个。若人类最终裁决为②，两处需要**一起改**——不要只改其中一个。
 */
import type { z } from "zod";
import { chat as C } from "@repo/contracts";
import type { ModelKind } from "../model/registry";

export type ApprovalDataScopeT = z.infer<typeof C.ApprovalDataScope>;
export type ApprovalExitT = z.infer<typeof C.ApprovalExit>;

/** 六项披露顺序取自契约 `createApprovalRequest.out` 与 domain.md I-28 逐字列举。 */
export const SIX_DISCLOSURE_FIELDS = [
  "title",
  "callChain",
  "models",
  "budget",
  "dataScope",
  "exits",
] as const;

/** 批准卡六项披露字段的最小形状——只取「非空」判定需要的部分。 */
export interface ApprovalCardDisclosure {
  readonly title: string;
  readonly callChain: readonly string[];
  readonly models: readonly { readonly modelId: string }[];
  readonly budget: { readonly tokens: number; readonly amount: number; readonly currency: string };
  readonly dataScope: readonly ApprovalDataScopeT[];
  readonly exits: readonly ApprovalExitT[];
}

/**
 * I-28：六项披露字段全部非空，缺一即失败。
 * ⚠ `exits` 数量本身是契约（恒 3），不是枚举成员数——`ApprovalExit` 三值封闭，
 *   这里额外断言长度而不是只判非空，防止未来枚举扩张时这条断言悄悄失效。
 */
export function sixFieldsDisclosed(card: ApprovalCardDisclosure): boolean {
  return (
    card.title.length > 0 &&
    card.callChain.length > 0 &&
    card.models.length > 0 &&
    card.budget.tokens >= 0 &&
    card.budget.amount >= 0 &&
    card.budget.currency.length > 0 &&
    card.dataScope.length > 0 &&
    card.exits.length === 3
  );
}

export function hasConfidential(scope: readonly ApprovalDataScopeT[]): boolean {
  return scope.some((d) => d.confidential);
}

/** 供批准卡引用的模型行——只取判定与折算需要的字段。 */
export interface ApprovalModelRow {
  readonly modelId: string;
  readonly kind: ModelKind;
  readonly displayName: string;
  /** 来自 model registry 的单价（CNY / 千 token；O-37：人工维护，非厂商同步）。 */
  readonly unitPrice: number;
}

/**
 * D-U1／I-32（本文件取①，见文件头）：含机密 ⇒ 集合里不得有 `kind !== "self-hosted"`。
 * 返回 `null` 表示合规；非 null 时是拒绝理由（供 `MODEL_POLICY_VIOLATION` 的 detail）。
 *
 * ⚠ 这里**不判断**"没有任何本地模型承接"这一档——D-U1 的字面是"整轮走本地"，
 *   若含机密而 `models` 为空，那是 I-28 的六项披露失败（models 非空），不在这里报告。
 */
export function modelPolicyViolation(
  dataScope: readonly ApprovalDataScopeT[],
  models: readonly Pick<ApprovalModelRow, "modelId" | "kind">[],
): string | null {
  if (!hasConfidential(dataScope)) return null;
  const cloud = models.filter((m) => m.kind !== "self-hosted");
  if (cloud.length === 0) return null;
  return `本轮含机密数据，按「全程本地」规则（D-U1）不得混入非本地模型：${cloud
    .map((m) => m.modelId)
    .join("、")}`;
}

export interface ApprovalBudget {
  readonly tokens: number;
  readonly amount: number;
  readonly currency: string;
}

/**
 * I-31：批准卡的模型标识、单价与折算金额恒来自 model registry，本模块不存在硬编码的
 * 模型名或价目表——这条不变量在这里的体现是：**唯一的输入是调用方传入的 registry 行**，
 * 函数体内没有任何模型 id 字面量或价格常量。
 *
 * ⚠ 折算公式（多模型时如何合并单价）没有任何 UC / ADR 给出——`design-signoff.md` 第 ③ 节
 *   逐字标注这是 `[待确认]` 项。这里取**保守估计：取本轮候选模型里单价最高的一档**，
 *   理由是批准卡的用途是「事前披露最坏情况的花费」，取均值会在最终账单超出披露值时
 *   丧失批准卡的信任意义。这是一个已登记的判断调用，不是裁决——公式一旦有人类裁决，
 *   只需要改这一处。
 */
export function budgetFromRegistry(
  tokens: number,
  models: readonly Pick<ApprovalModelRow, "unitPrice">[],
): ApprovalBudget {
  const maxUnitPrice = models.reduce((max, m) => Math.max(max, m.unitPrice), 0);
  // 单价单位：CNY / 1000 token（见 apps/api/migrations/0019-f48-model-pool.sql 头部
  // "unit_price ... CNY, maintained by hand"——该文件同样没有定义计量单位，
  // 这里采用最常见的按千 token 计价惯例，登记为已知假设）。
  const amount = Math.round((tokens / 1000) * maxUnitPrice * 100) / 100;
  return { tokens, amount, currency: "CNY" };
}
