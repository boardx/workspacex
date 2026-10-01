import { BillingPreview } from "@/components/billing/billing-preview";
import {
  ORDER_STAGES,
  PREVIEW_STATES,
  ROLES,
  SUBJECTS,
  SUB_VARIANTS,
  type OrderStage,
  type PreviewRole,
  type PreviewState,
  type PurchaseSubject,
  type SubscriptionVariant,
} from "@/lib/mock/billing";

/**
 * Phase-21 billing-payment UI 先行原型入口（ADR-023 签核第 ① 件材料）。
 * 纯 mock，不接后端。query：
 *   ?screen= cashier | subscription | admin | org-billing | menu
 *   ?state=  default | loading | empty | invalid | depfail | denied | success
 *   ?stage=  default | pending | success | expired | failed（收银台订单态）
 *   ?subject= personal | org
 *   ?role=   user | org-admin | platform-admin
 *   ?sub=    free | active | trialing | canceled | syncing
 *   ?billing= on | off（组织计费开关）  ?grant= idle | confirm | done（发放确认）
 *
 * ⚠ 生产环境这些界面落在既有收银台弹窗 / 用户菜单 / 组织管理页 / 平台管理端；
 *   此预览页只为逐屏逐态签核把它们单独铺出来，不新建生产路由。
 */
type ScreenKey = "cashier" | "subscription" | "admin" | "org-billing" | "menu";

const SCREEN_KEYS: readonly ScreenKey[] = ["cashier", "subscription", "admin", "org-billing", "menu"];

function oneOf<T extends string>(raw: string | undefined, keys: readonly { key: T }[], fallback: T): T {
  return keys.some((k) => k.key === raw) ? (raw as T) : fallback;
}

export default function BillingPreviewPage({
  searchParams,
}: {
  searchParams: {
    screen?: string;
    state?: string;
    stage?: string;
    subject?: string;
    role?: string;
    sub?: string;
    billing?: string;
    grant?: string;
  };
}) {
  const screen = oneOf(searchParams.screen, SCREEN_KEYS.map((k) => ({ key: k })), "cashier");
  const state = oneOf(searchParams.state, PREVIEW_STATES, "default");
  const stage = oneOf(searchParams.stage, ORDER_STAGES, "default");
  const subject = oneOf(searchParams.subject, SUBJECTS, "personal");
  const role = oneOf(searchParams.role, ROLES, "platform-admin");
  const sub = oneOf(searchParams.sub, SUB_VARIANTS, "free");
  const billingEnabled = searchParams.billing !== "off";
  const grantStage: "idle" | "confirm" | "done" =
    searchParams.grant === "confirm" ? "confirm" : searchParams.grant === "done" ? "done" : "idle";

  return (
    <BillingPreview
      screen={screen}
      state={state as PreviewState}
      stage={stage as OrderStage}
      subject={subject as PurchaseSubject}
      role={role as PreviewRole}
      sub={sub as SubscriptionVariant}
      billingEnabled={billingEnabled}
      grantStage={grantStage}
    />
  );
}
