/** Atomic multi-file Skill editing; principal and organization come only from existing auth. */
import { Body, Controller, Get, Post, Param, Query, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { operations } from "@repo/contracts/skill-file-edit";
import { getSkillFileSnapshot, saveSkillFiles, SkillFileEditError, SKILL_FILE_EDIT_REPOSITORY, type SkillFileEditRepository } from "../../application/skill/edit-skill-files";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
const bodySchema = operations.saveSkillFiles.in.innerType().omit({ skillId: true });
const status = { EDIT_NOT_ORG_ADMIN: HttpStatus.FORBIDDEN, EDIT_SKILL_NOT_FOUND: HttpStatus.NOT_FOUND,
  EDIT_VERSION_CONFLICT: HttpStatus.CONFLICT, EDIT_READ_ONLY: HttpStatus.FORBIDDEN,
  EDIT_CONTENT_INVALID: HttpStatus.UNPROCESSABLE_ENTITY, DEPENDENCY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE } as const;
@Controller()
export class SkillFileEditController {
  constructor(@Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_FILE_EDIT_REPOSITORY) private readonly repository: SkillFileEditRepository) {}
  @Get(operations.getSkillFileSnapshot.path)
  async read(@CurrentPrincipal() principal: Principal, @Param("skillId") skillId: string, @Query("versionId") versionId: string) {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(operations.getSkillFileSnapshot.in).transform({ skillId, versionId }) as ReturnType<typeof operations.getSkillFileSnapshot.in.parse>;
    return this.run(() => getSkillFileSnapshot({ ...input, orgId: principal.orgId, actorId: principal.userId }, { identities: this.identities, repository: this.repository }));
  }
  @Post(operations.saveSkillFiles.path)
  async save(@CurrentPrincipal() principal: Principal, @Param("skillId") skillId: string,
    @Body(new ZodBodyPipe(bodySchema)) body: ReturnType<typeof bodySchema.parse>) {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(operations.saveSkillFiles.in).transform({ ...body, skillId }) as ReturnType<typeof operations.saveSkillFiles.in.parse>;
    return this.run(() => saveSkillFiles({ ...input, orgId: principal.orgId, actorId: principal.userId }, { identities: this.identities, repository: this.repository }));
  }
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof SkillFileEditError) throw new HttpException({ reasonCode: error.code,
        ...(error.currentVersionId ? { currentVersionId: error.currentVersionId } : {}) }, status[error.code]);
      throw error;
    }
  }
}
