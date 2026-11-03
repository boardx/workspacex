import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import {EnterpriseError,type EnterprisePaidTeamPort} from "../../application/billing/enterprise-ports";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";

/** Only absence established from the canonical commercial record can take this lane. */
export async function assertNoPaidTeam(s:TenantSession,orgId:OrgId):Promise<void>{
 const license=(await s.query<{generation:string;purchased_seats:string|null;pending_seats:string|null;pending_purchase_ref:string|null}>("SELECT generation,purchased_seats::text,pending_seats::text,pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1 FOR UPDATE",[orgId])).rows[0];
 if(license)throw new EnterpriseError("dependency_unavailable");
}
/** Does not claim to cancel or retain paid Team subscriptions; those fail closed. */
export class EnterpriseNoPaidTeamAdapter implements EnterprisePaidTeamPort {
 constructor(private readonly db:DatabasePort){}
 readPaidTeamTerm(orgId:OrgId):Promise<null>{return this.db.withTenant(orgId,async s=>{
  try{await requireActivePricingEpoch(s);}catch{throw new EnterpriseError("dependency_unavailable");}
  if(!(await s.query("SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE",[orgId])).rows.length)throw new EnterpriseError("ORGANIZATION_NOT_FOUND");
  await assertNoPaidTeam(s,orgId);return null;
 });}
 async stopFutureRenewal():Promise<never>{throw new EnterpriseError("dependency_unavailable");}
}
