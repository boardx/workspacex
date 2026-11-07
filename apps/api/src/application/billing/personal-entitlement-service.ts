import { PricingSubscriptionInfo } from "@repo/contracts/billing-pricing";
import { assertPrincipal, type Principal } from "../../domain/principal";
export interface PersonalEntitlementRepository { read(principal: Principal): Promise<PricingSubscriptionInfo> }
export class PersonalEntitlementService {
  constructor(private readonly repository: PersonalEntitlementRepository) {}
  async read(principal: Principal) { assertPrincipal(principal); return PricingSubscriptionInfo.parse(await this.repository.read(principal)); }
}
