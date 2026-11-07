import {assertPrincipal,type Principal} from "../../domain/principal";
import {toOrgId} from "../../domain/org-id";
import type {IdentityRepository} from "../identity/ports";
/** Target-organization admin action, never a platform financial read privilege. */
export class TeamBillingAccess{
 constructor(private readonly identity:Pick<IdentityRepository,"findOrgMembership"|"findOrganization">){}
 async authorize(principal:Principal,target:string){
  assertPrincipal(principal);
  let orgId;
  try{orgId=toOrgId(target);}catch{throw Error("forbidden");}
  const membership=await this.identity.findOrgMembership(principal.userId,orgId);
  if(membership?.orgRole!=="admin")throw Error("forbidden");
  const organization=await this.identity.findOrganization(orgId);
  if(organization?.kind!=="organization")throw Error("forbidden");
  return orgId;
 }
}
