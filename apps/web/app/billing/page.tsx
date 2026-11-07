import * as React from "react";
import { BillingContent } from "./billing-content";

// Runtime opt-in is separate from the accounting epoch; production activation is a later release step.
export const dynamic = "force-dynamic";
export default function BillingPage() {
  return <React.Suspense fallback={<p role="status">正在查询账户…</p>}><BillingContent personalPricingEnabled={process.env.BILLING_PERSONAL_PRICING_UI_ENABLED === "true"}/></React.Suspense>;
}
