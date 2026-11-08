import {Body,Controller,Inject,Param,Post} from "@nestjs/common";
import { skills as C } from "@repo/contracts";
import {SKILL_CONTRACT_REPOSITORY,SKILL_SUBMITTER_GRANTS,SKILL_SECURITY_AUDIT,type SkillContractRepositoryFactory,type SubmitterGrantsPort,type SecurityAuditPort} from "../../application/skill/ports";
import type {Principal} from "../../domain/principal";
import {CurrentPrincipal} from "../current-principal.decorator";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
import {SkillReviewActions} from "./skill-review-actions";
import type {z} from "zod";
@Controller()
export class SkillReviewController {
 private readonly actions:SkillReviewActions;
 constructor(@Inject(SKILL_CONTRACT_REPOSITORY) repositories:SkillContractRepositoryFactory,@Inject(SKILL_SUBMITTER_GRANTS) grants:SubmitterGrantsPort,@Inject(SKILL_SECURITY_AUDIT) audit:SecurityAuditPort){this.actions=new SkillReviewActions(repositories,grants,audit);}
 @Post(C.operations.runSecurityScan.path)
 scan(@CurrentPrincipal() p:Principal,@Param("versionId") id:string,@Body(new ZodBodyPipe(C.operations.runSecurityScan.in)) body:z.infer<typeof C.operations.runSecurityScan.in>){return this.actions.scan(p,id,body,p.orgId);}
 @Post(C.operations.submitSkillForReview.path)
 submit(@CurrentPrincipal() p:Principal,@Param("versionId") id:string,@Body(new ZodBodyPipe(C.operations.submitSkillForReview.in)) body:z.infer<typeof C.operations.submitSkillForReview.in>){return this.actions.submit(p,id,body,p.orgId);}
 @Post(C.operations.reviewSkillVersion.path)
 review(@CurrentPrincipal() p:Principal,@Param("versionId") id:string,@Body(new ZodBodyPipe(C.operations.reviewSkillVersion.in)) body:z.infer<typeof C.operations.reviewSkillVersion.in>){return this.actions.review(p,id,body,p.orgId);}
}
