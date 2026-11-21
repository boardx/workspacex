import type { SaveStageInput, SharedStageValue } from "@repo/contracts/aidt-stages";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { ProjectResourceRow } from "../project/project-resource-ports";
import type { IdentityRepository } from "../identity/ports";
export type StageActor = { orgId: OrgId; userId: string; projectId: string };
export interface StageTransaction {
  identity: IdentityRepository;
  project: { status: string; orgStatus: string; aidt: boolean } | null;
  revision?(stageId: number, revision: number): Promise<Guarded<SharedStageValue | null>>;
  projectResources?(): Promise<Guarded<readonly ProjectResourceRow[] | null>>;
  ensureEntityThread?(threadId: string, title: string): Promise<Guarded<{ threadId: string }>>;
  current(stageId: number): Promise<Guarded<SharedStageValue | null>>;
  history(stageId:number,beforeRevision:number|undefined,limit:number):Promise<Guarded<SharedStageValue[]>>;
  receipt(operationId:string):Promise<Guarded<{requestKey:string;stage:SharedStageValue}|null>>;
  append(input:SaveStageInput,requestKey:string):Promise<Guarded<SharedStageValue>>;
  hasRevision(stageId:number,revision:number):Promise<boolean>;
  hasImageAttachment(ref:{attachmentId:string;threadId:string;name:string}):Promise<boolean>;
}
export interface AidtStageRepository { inProject<T>(actor:StageActor,fn:(tx:StageTransaction)=>Promise<T>):Promise<T> }
export const AIDT_STAGE_REPOSITORY = Symbol("AidtStageRepository");
