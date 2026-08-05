/**
 * 受访者授权的两种令牌（F86 / uc-6-3 R3，已裁决 O-15）—— 最内层，纯函数，没有库、没有 HTTP。
 *
 * ## 为什么是「两种令牌」而不是一种更长/更短的令牌
 *
 * 旧稿把这里写成「组员入口 24 小时」单一令牌：一枚令牌既要签署又要长期自助。
 * 那句口径已被 D-15/O-15 废弃 —— 两个动作的安全性质完全不同：
 *
 *   · **签署令牌**：一次性动作（勾同意 → 提交），用过即废，7 天打底防止链接烂在收件箱里。
 *   · **门户长效令牌**：一项**持续的权利**（改选择 / 要副本 / 要删除），
 *     有效期必须跟着「材料还在」走 —— 材料保留期一过，撤回权本身就没有意义了。
 *
 * 把两者合成一枚令牌，要么签署链接必须长期有效（则「一次性」不成立，
 * 泄露的链接能在 7 天后依然被人拿来改同意），要么自助门户必须在 7 天后失效
 * （则「材料还在、撤回权就在」不成立）。**这里因此拒绝存在单一 24 小时令牌的实现路径**：
 * 没有任何函数把两种用途的有效期算成同一个数字，`SIGNING_TOKEN_TTL_MS` 与
 * `portalTokenExpiresAt` 分属两个不同的计算，且没有共享的「24h」常量。
 *
 * ⚠ 与 `domain/auth/invite-link.ts` 的 `validityDurationMs` 不是同一个事实：
 *   那边是三档可选有效期（组织进场邀请），这里恒定两种、且第二种的时长
 *   来自**该场访谈的材料保留期**（`ResearchPlanParams.retentionDays`），不是一个固定档位。
 */
import { randomBytes } from "node:crypto";
import { CONSENT_ITEMS, type ConsentItemValue } from "@repo/contracts/consent-item";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 签署令牌：恒 7 天、一次性。字面量只在这一处出现。 */
export const SIGNING_TOKEN_TTL_MS = 7 * DAY_MS;

/** 渲染这份同意书所需的四个变量。任一缺失 ⇒ `RETENTION_PARAMS_MISSING`，不得发链接（E2）。 */
export interface ConsentRenderParams {
  readonly retentionDays: number;
  readonly dataController: string;
  readonly contactName: string;
  readonly complianceEmail: string;
}

/**
 * 四个渲染变量是否齐全。
 *
 * ⚠ 字符串字段用「非空」判定，不是「非 undefined」——空串在界面上渲染成
 *   「数据控制方：」，与缺失同样是「发一份告知不完整的同意书」，比不发更糟。
 */
export function hasCompleteRenderParams(
  params: Partial<ConsentRenderParams> | null | undefined,
): params is ConsentRenderParams {
  if (params === null || params === undefined) return false;
  return (
    Number.isFinite(params.retentionDays) &&
    (params.retentionDays as number) > 0 &&
    typeof params.dataController === "string" &&
    params.dataController.trim() !== "" &&
    typeof params.contactName === "string" &&
    params.contactName.trim() !== "" &&
    typeof params.complianceEmail === "string" &&
    params.complianceEmail.trim() !== ""
  );
}

/** 签发时刻 + 7 天。**不解析任何「有效期档位」枚举**——签署令牌只有一档。 */
export function signingTokenExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + SIGNING_TOKEN_TTL_MS);
}

/**
 * 门户长效令牌的到期时刻 = 提交时刻 + 该场材料保留期。
 *
 * ⚠ 天数来自调用方传入的 `retentionDays`（服务端单一事实源 `ResearchPlanParams`），
 *   这里**不写死任何默认值**——「默认 180 天」是产品档案里的默认*参数值*，
 *   不是本函数的默认*行为*：调用方不传参数，这里就该在类型层过不去。
 */
export function portalTokenExpiresAt(issuedAt: Date, retentionDays: number): Date {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(
      `portalTokenExpiresAt: retentionDays 必须是正数，收到 ${String(retentionDays)}。` +
        `这条不变量守的是「材料还在，撤回权就在」——一个非正数会让门户令牌在签发瞬间就已过期。`,
    );
  }
  return new Date(issuedAt.getTime() + retentionDays * DAY_MS);
}

/** 256 位 CSPRNG，base64url。两种令牌各自生成，不共享同一枚随机数来源以外的东西。 */
export function newSigningToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newPortalToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newSigningTokenId(): string {
  return `stk-${randomBytes(12).toString("hex")}`;
}

export function newPortalTokenId(): string {
  return `ptk-${randomBytes(12).toString("hex")}`;
}

export function newConsentSnapshotId(): string {
  return `csnap-${randomBytes(12).toString("hex")}`;
}

export function newConsentSubmissionId(): string {
  return `csub-${randomBytes(12).toString("hex")}`;
}

/**
 * 同意书四项的逐字措辞（AC3）。**这是同意书渲染快照的静态部分**——
 * 四项的 key/文案/降级语义固定，随项目变化的只有 `ConsentRenderParams` 里的四个变量，
 * 后者在措辞里以占位符出现，由调用方（`getConsentPage`）插值。
 *
 * ⚠ 四项的顺序与措辞逐字取自 uc-6-3 R3 第 3 步，不是这里新拟的文案。
 */
/**
 * F96 —— 把「当初告知你的是什么」渲染成一段可展示的纯文本，供自助门户回看。
 *
 * ⚠ 入参 `params`/`bits` 必须是**已落盘的快照字段**（`ConsentSnapshotRow.renderParams`/
 *   `.bits`），不是当下重新查询的项目参数——这样即使项目的材料保留期之后被改掉，
 *   这段文本依然是「当时」那一份，不会跟着漂移（AC5）。本函数本身是纯计算，
 *   不做任何 I/O，「不漂移」这条不变量由调用方传入冻结数据来保证，不是本函数保证的。
 */
export function renderConsentSnapshotText(
  params: ConsentRenderParams,
  bits: Record<ConsentItemValue, boolean>,
): string {
  // 顺序由契约的 `CONSENT_ITEMS` 决定，不由本文件那张文案表的书写顺序决定（#533）。
  const lines = CONSENT_ITEMS.map((key) => {
    const item = CONSENT_ITEM_COPY[key];
    const granted = bits[key];
    return `${granted ? "☑" : "☐"} ${item.label}${granted ? "" : `——${item.optOutConsequence}`}`;
  });
  return [
    `材料保留期：${params.retentionDays} 天`,
    `数据控制方：${params.dataController}`,
    `联系人：${params.contactName}`,
    `合规邮箱：${params.complianceEmail}`,
    ...lines,
  ].join("\n");
}

/**
 * ⚠ 键集**恰好**是 `CONSENT_ITEMS`（#533）：`Record<ConsentItemValue, …>` 让 tsc 在
 *   少一项或多一项时直接编译不过。原来这里是一个带 `key: "..." as const` 的数组，
 *   那是同意项的第五份手写副本，而对象/数组字面量逃得过文本扫描——所以这一类
 *   靠类型系统兜底，不靠 `consent-items-single-source.test.ts` 的扫描。
 */
export const CONSENT_ITEM_COPY: Record<
  ConsentItemValue,
  { readonly label: string; readonly optOutConsequence: string }
> = {
  record: {
    label: "录音",
    optOutConsequence: "未勾选时不会为你录音。",
  },
  transcript: {
    label: "转成文字稿",
    optOutConsequence: "未勾选时不会为你的发言生成文字稿。",
  },
  ai_analysis: {
    label: "交给 AI 做分析",
    optOutConsequence: "你已拒绝——你的话只会以原文引述出现，不参与任何自动归纳。",
  },
  attribution: {
    label: "在报告中署我的姓名与职务",
    optOutConsequence: "未勾选时一律写成「某物流园区运营总监」。",
  },
};
