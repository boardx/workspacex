import type {z} from "zod";
import type {Candidate} from "@repo/contracts/organization-core-model";
import type {OrgId} from "../../domain/org-id";
import type {IdentityRepository} from "../identity/ports";
import {OrgCoreModelError} from "./org-core-model-ports";
export type OrgCoreModelCandidateRow=z.infer<typeof Candidate>;
export interface OrgCoreModelCandidateReader {
 /** Tenant formal pool only. Unknown deployment/price metadata remains null and unavailable. */
 list(orgId:OrgId,actorId:string):Promise<readonly OrgCoreModelCandidateRow[]>;
}
export const ORG_CORE_MODEL_CANDIDATE_READER=Symbol("OrgCoreModelCandidateReader");
export async function listOrgCoreModelCandidates(deps:{identity:IdentityRepository;candidates:OrgCoreModelCandidateReader},orgId:OrgId,actorId:string){
 if((await deps.identity.findOrgMembership(actorId,orgId))?.orgRole!=="admin")throw new OrgCoreModelError("NOT_ORG_ADMIN");
 return deps.candidates.list(orgId,actorId);
}
