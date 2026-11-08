import {Body,Controller,Inject,Param,Post,UseGuards} from "@nestjs/common";
import {legacySkillOperations as O} from "@repo/contracts/ai-catalog-admin";
import {PlatformOperatorGuard} from "../guards/platform-operator.guard";
import {SKILL_CONTRACT_REPOSITORY,SKILL_SUBMITTER_GRANTS,SKILL_SECURITY_AUDIT,type SkillContractRepositoryFactory,type SubmitterGrantsPort,type SecurityAuditPort} from "../../application/skill/ports";
import type {Principal} from "../../domain/principal";
import {CurrentPrincipal} from "../current-principal.decorator";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
import {SkillReviewActions} from "./skill-review-actions";
import {AI_CATALOG_ADMIN_SERVICE,type AiCatalogAdminService} from "../../application/ai-catalog/admin-service";
import type {z} from "zod";
@UseGuards(PlatformOperatorGuard)
@Controller()
export class PlatformSkillReviewController {
 private readonly actions:SkillReviewActions;
 constructor(@Inject(SKILL_CONTRACT_REPOSITORY) repositories:SkillContractRepositoryFactory,@Inject(SKILL_SUBMITTER_GRANTS) grants:SubmitterGrantsPort,@Inject(SKILL_SECURITY_AUDIT) audit:SecurityAuditPort,@Inject(AI_CATALOG_ADMIN_SERVICE) private readonly catalog:AiCatalogAdminService){this.actions=new SkillReviewActions(repositories,grants,audit);}
 @Post(O.scan.path)
 async scan(@CurrentPrincipal() p:Principal,@Param("orgId") orgId:string,@Param("versionId") id:string,@Body(new ZodBodyPipe(O.scan.in)) body:z.infer<typeof O.scan.in>){await this.catalog.assertReviewTarget(orgId);return this.actions.scan(p,id,body,orgId);}
 @Post(O.submit.path)
 async submit(@CurrentPrincipal() p:Principal,@Param("orgId") orgId:string,@Param("versionId") id:string,@Body(new ZodBodyPipe(O.submit.in)) body:z.infer<typeof O.submit.in>){await this.catalog.assertReviewTarget(orgId);return this.actions.submit(p,id,body,orgId);}
 @Post(O.review.path)
 async review(@CurrentPrincipal() p:Principal,@Param("orgId") orgId:string,@Param("versionId") id:string,@Body(new ZodBodyPipe(O.review.in)) body:z.infer<typeof O.review.in>){await this.catalog.assertReviewTarget(orgId);return this.actions.review(p,id,body,orgId);}
}
