import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { OrgCoreModelError,type OrgCoreModelRepository } from "./org-core-model-ports";
async function requireAdmin(identity:IdentityRepository,orgId:OrgId,actorId:string):Promise<void>{
 const membership=await identity.findOrgMembership(actorId,orgId);
 if(membership?.orgRole!=="admin")throw new OrgCoreModelError("NOT_ORG_ADMIN");
}
export async function readOrgCoreModel(deps:{identity:IdentityRepository;repository:OrgCoreModelRepository},orgId:OrgId,actorId:string){
 await requireAdmin(deps.identity,orgId,actorId);
 return deps.repository.read(orgId);
}
export async function setOrgCoreModel(deps:{identity:IdentityRepository;repository:OrgCoreModelRepository},orgId:OrgId,actorId:string,input:{expectedVersion:number;modelId:string;reason:string}){
 await requireAdmin(deps.identity,orgId,actorId);
 if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>=2147483647
  ||!input.modelId.trim()||input.modelId.length>200||!input.reason.trim()||input.reason.length>1000)
  throw new OrgCoreModelError("CORE_MODEL_INPUT_INVALID");
 return deps.repository.set(orgId,{...input,actorId});
}
