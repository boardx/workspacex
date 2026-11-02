import { TEAM_INCLUDED_SEATS } from "@repo/contracts/billing-team";
/** Opaque current billing epoch; supplied by the canonical billing authority. */
export interface CommercialCapacityFacts {
  readonly generation: string;
  readonly purchasedSeats: string | null;
  readonly pendingSeats: string | null;
  readonly pendingPurchaseRef: string | null;
}
export type CommercialCapacity =
  | { readonly kind: "legacy" }
  | { readonly kind: "unlimited" }
  | { readonly kind: "limited"; readonly seats: bigint }
  | { readonly kind: "invalid" };

/** Memberships, of every org role, are counted by the caller in its locked transaction. */
export function resolveCommercialCapacity(
  currentGeneration: string,
  plan: { readonly plan: string; readonly billingGeneration: string | null } | null,
  license: CommercialCapacityFacts | null,
): CommercialCapacity {
  if (!currentGeneration) return { kind: "invalid" };
  if (plan?.billingGeneration != null && plan.billingGeneration !== currentGeneration) return { kind: "invalid" };
  if (license !== null && license.generation !== currentGeneration) return { kind: "invalid" };
  if (plan?.plan === "enterprise" && plan.billingGeneration === currentGeneration) return { kind: "unlimited" };
  if (license === null) return { kind: plan?.billingGeneration != null ? "invalid" : "legacy" };
  if ((license.pendingSeats === null) !== (license.pendingPurchaseRef === null)) return { kind: "invalid" };
  const parse = (value: string | null): bigint | null => value !== null && /^\d+$/.test(value) && BigInt(value) >= BigInt(TEAM_INCLUDED_SEATS) ? BigInt(value) : null;
  const purchased = parse(license.purchasedSeats), pending = parse(license.pendingSeats);
  if ((license.purchasedSeats !== null && purchased === null) || (license.pendingSeats !== null && pending === null)
    || (purchased === null && pending === null) || license.pendingPurchaseRef === "") return { kind: "invalid" };
  return { kind: "limited", seats: purchased === null ? pending! : pending === null ? purchased : purchased < pending ? purchased : pending };
}
