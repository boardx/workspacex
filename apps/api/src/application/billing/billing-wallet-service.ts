import type { z } from "zod";
import { operations } from "@repo/contracts/billing-credits";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId, type OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";

export type WalletQuery = z.infer<typeof operations.getWallet.in>;
export type LedgerQuery = z.infer<typeof operations.listTransactions.in>;
export interface BillingOwner {
  readonly ownerType: WalletQuery["ownerType"];
  readonly ownerId: string;
  readonly orgId: OrgId;
}
export interface BillingWalletRepository {
  wallet(owner: BillingOwner): Promise<z.infer<typeof operations.getWallet.out>>;
  transactions(owner: BillingOwner, input: LedgerQuery): Promise<z.infer<typeof operations.listTransactions.out>>;
}
export class BillingWalletAccessError extends Error {
  constructor() { super("forbidden"); }
}
export class BillingWalletCursorError extends Error {
  constructor() { super("invalid_cursor"); }
}
/** PrincipalGuard supplies identity; membership and platform access remain their existing authorities. */
export class BillingWalletService {
  constructor(
    private readonly repository: BillingWalletRepository,
    private readonly identity: Pick<IdentityRepository, "findOrgMembership">,
    private readonly isPlatformOperator: (userId: string) => Promise<boolean>,
  ) {}
  private async owner(principal: Principal, input: WalletQuery): Promise<BillingOwner> {
    assertPrincipal(principal);
    if (input.ownerType === "user") {
      if (input.ownerId !== undefined && input.ownerId !== principal.userId) throw new BillingWalletAccessError();
      return {ownerType:"user",ownerId:principal.userId,orgId:principal.orgId};
    }
    const ownerId = input.ownerId ?? principal.orgId;
    let orgId: OrgId;
    try { orgId = toOrgId(ownerId); } catch { throw new BillingWalletAccessError(); }
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership?.orgRole !== "admin" && !await this.isPlatformOperator(principal.userId)) throw new BillingWalletAccessError();
    return {ownerType:"team",ownerId,orgId};
  }
  async wallet(principal: Principal, input: WalletQuery) {
    const owner = await this.owner(principal, operations.getWallet.in.parse(input));
    return operations.getWallet.out.parse(await this.repository.wallet(owner));
  }
  async transactions(principal: Principal, input: LedgerQuery) {
    const parsed = operations.listTransactions.in.parse(input);
    const owner = await this.owner(principal, parsed);
    return operations.listTransactions.out.parse(await this.repository.transactions(owner, parsed));
  }
}
