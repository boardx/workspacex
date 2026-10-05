import {Body,Controller,Get,HttpException,Inject,Patch} from "@nestjs/common";
import {operations,State} from "@repo/contracts/organization-core-model";
import type {z} from "zod";
import {CurrentPrincipal} from "../current-principal.decorator";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {IDENTITY_REPOSITORY,type IdentityRepository} from "../../application/identity/ports";
import {ORG_CORE_MODEL_REPOSITORY,OrgCoreModelError,type OrgCoreModelRepository,type OrgCoreModelState} from "../../application/model/org-core-model-ports";
import {ORG_CORE_MODEL_CANDIDATE_READER,listOrgCoreModelCandidates,type OrgCoreModelCandidateReader} from "../../application/model/org-core-model-candidates";
import {readOrgCoreModel,setOrgCoreModel} from "../../application/model/org-core-model";
const statuses={NOT_ORG_ADMIN:403,ORGANIZATION_REQUIRED:403,CORE_MODEL_UNAVAILABLE:422,VERSION_CHANGED:409,CORE_MODEL_INPUT_INVALID:400} as const;
/** Internal connection identity stays on the server; public contracts project only declared metadata. */
function publicState(state:OrgCoreModelState){
 const selected=state.selection;
 return State.parse({version:state.version,selection:selected?{modelId:selected.modelId,modelProvider:selected.modelProvider,runtimeModelId:selected.runtimeModelId,configRevision:selected.configRevision}:null,updatedBy:state.updatedBy,reason:state.reason});
}
@Controller()
export class OrgCoreModelController {
 constructor(@Inject(IDENTITY_REPOSITORY) private readonly identity:IdentityRepository,
  @Inject(ORG_CORE_MODEL_REPOSITORY) private readonly repository:OrgCoreModelRepository,
  @Inject(ORG_CORE_MODEL_CANDIDATE_READER) private readonly candidates:OrgCoreModelCandidateReader){}
 private async execute<T>(call:()=>Promise<T>):Promise<T>{
  try{return await call();}catch(error){if(error instanceof OrgCoreModelError)throw new HttpException({reasonCode:error.code},statuses[error.code]);throw error;}
 }
 @Get(operations.get.path)
 async get(@CurrentPrincipal() principal:Principal){
  assertPrincipal(principal);
  return this.execute(async()=>publicState(await readOrgCoreModel({identity:this.identity,repository:this.repository},principal.orgId,principal.userId)));
 }
 @Get(operations.candidates.path)
 async listCandidates(@CurrentPrincipal() principal:Principal){
  assertPrincipal(principal);
  return this.execute(async()=>operations.candidates.out.parse(await listOrgCoreModelCandidates({identity:this.identity,candidates:this.candidates},principal.orgId,principal.userId)));
 }
 @Patch(operations.set.path)
 async set(@CurrentPrincipal() principal:Principal,@Body(new ZodBodyPipe(operations.set.in)) input:z.infer<typeof operations.set.in>){
  assertPrincipal(principal);
  // Use case authorizes before persistence; request validation never permits an org or connection override.
  return this.execute(async()=>{
   if((await this.identity.findOrgMembership(principal.userId,principal.orgId))?.orgRole!=="admin")throw new OrgCoreModelError("NOT_ORG_ADMIN");
   const parsed=operations.set.in.safeParse(input);if(!parsed.success)throw new OrgCoreModelError("CORE_MODEL_INPUT_INVALID");
   return publicState(await setOrgCoreModel({identity:this.identity,repository:this.repository},principal.orgId,principal.userId,parsed.data));
  });
 }
}
