import { PricingPreview } from "@/components/billing/pricing-preview";

/** #6086 UI-only signoff route; production billing routes remain unchanged. */
export default function PricingPreviewPage() {
  return <PricingPreview />;
}
