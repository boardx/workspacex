import type { EnterpriseUpgradeRequest, EnterpriseUpgradeOperation } from "@repo/contracts/billing-team";
import {creditFacts} from "./credit-consumption";
import type { OrgId } from "../../domain/org-id";
import { EnterpriseError, type EnterprisePaidTeamPort, type EnterpriseUpgradeStore } from "./enterprise-ports";

/** Provider calls happen outside the Plan transaction; replay always uses the same operationRef. */
export class EnterpriseUpgrade {
  constructor(private readonly store:EnterpriseUpgradeStore,private readonly paidTeam:EnterprisePaidTeamPort|null) {}
  async upgrade(orgId:OrgId,actorId:string,input:EnterpriseUpgradeRequest):Promise<EnterpriseUpgradeOperation> {
    const operation=await this.store.begin(orgId,actorId,input);
    if(operation.status!=="processing")return operation;
    return this.resume(orgId,operation);
  }
  operation(orgId:OrgId,operationRef:string):Promise<EnterpriseUpgradeOperation> { return this.store.read(orgId,operationRef); }
  private async resume(orgId:OrgId,operation:EnterpriseUpgradeOperation):Promise<EnterpriseUpgradeOperation> {
    if(!this.paidTeam)return this.store.pending(orgId,operation.operationRef,"dependency_unavailable");
    try {
      const paid=await this.paidTeam.readPaidTeamTerm(orgId);
      const retained=paid===null?null:await this.paidTeam.stopFutureRenewal(orgId,operation.operationRef,paid);
      // Provider cancellation may alter renewal status, never the purchased term or quota.
      if(paid&&(!retained||creditFacts(retained.term)!==creditFacts(paid.term)||retained.provider!==paid.provider||retained.renewalMode!==paid.renewalMode))throw new EnterpriseError("dependency_unavailable");
      if(retained?.provider==="stripe"&&!retained.cancelAtPeriodEnd&&retained.subscriptionStatus!=="canceled")throw new EnterpriseError("dependency_unavailable");
      return await this.store.activate(orgId,operation.operationRef,retained);
    } catch(error) {
      return this.store.pending(orgId,operation.operationRef,error instanceof EnterpriseError&&error.code==="PLAN_VERSION_CONFLICT"?error.code:"dependency_unavailable");
    }
  }
}
