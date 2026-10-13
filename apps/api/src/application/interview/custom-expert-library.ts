import { CreateInterviewCustomExpert, InterviewCustomExpertList, type InterviewCustomExpert } from '@repo/contracts/interview-expert-library';
import type { z } from 'zod';
import type { OrgId } from '../../domain/org-id';
import type { OrgRole } from '../../domain/identity/roles';
import type { DecisionIdFactory } from '../identity/ports';
import type { InterviewScopeRepository } from './ports';
import { discloseDecided,isDisclosed,type Guarded } from '../security/permission-filter';
export const INTERVIEW_CUSTOM_EXPERT_LIBRARY = Symbol('InterviewCustomExpertLibrary');
export type ExpertLibraryActor = {orgId:OrgId;actorId:string};
export type StoredCustomExpert={orgId:OrgId;actorId:string;item:Guarded<InterviewCustomExpert>};
export interface InterviewCustomExpertLibrary {
 list(actor:ExpertLibraryActor):Promise<readonly StoredCustomExpert[]>;
 create(actor:ExpertLibraryActor,input:z.infer<typeof CreateInterviewCustomExpert>):Promise<StoredCustomExpert>;
}
export class ExpertLibraryAccessError extends Error {}
export class ExpertLibraryConflictError extends Error {}
/** Same active membership/personal-owner boundary used by existing expert preferences. */
export async function authorizeExpertLibrary(scope:InterviewScopeRepository,actor:ExpertLibraryActor){
 const membership=await scope.orgMembershipOf(actor.orgId,actor.actorId);
 if(membership.orgRole===null)throw new ExpertLibraryAccessError();
 return membership;
}
type Deps={scope:InterviewScopeRepository;repo:InterviewCustomExpertLibrary;decisions:DecisionIdFactory};
async function disclose(deps:Deps,actor:ExpertLibraryActor,items:readonly StoredCustomExpert[]){
 const membership=await authorizeExpertLibrary(deps.scope,actor);
 return items.map(stored=>{
  const orgPassed=stored.orgId===actor.orgId;
  const allowed=orgPassed&&stored.actorId===actor.actorId;
  const result=discloseDecided(stored.item,{allowed,orgLayer:{role:membership.orgRole as OrgRole,teamId:membership.teamId,passed:orgPassed},projectLayer:null,scopeLayer:{scope:'org-wide',passed:allowed},reasonCode:allowed?null:'ORG_SCOPE_DENIED',decisionId:deps.decisions.next()});
  if(!isDisclosed(result))throw new ExpertLibraryAccessError();
  return result.payload;
 });
}
export async function listCustomExperts(deps:Deps,actor:ExpertLibraryActor){
 await authorizeExpertLibrary(deps.scope,actor);
 return InterviewCustomExpertList.parse({items:await disclose(deps,actor,await deps.repo.list(actor))});
}
export async function createCustomExpert(deps:Deps,actor:ExpertLibraryActor,input:z.infer<typeof CreateInterviewCustomExpert>){
 await authorizeExpertLibrary(deps.scope,actor);
 return (await disclose(deps,actor,[await deps.repo.create(actor,input)]))[0]!;
}
