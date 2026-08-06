/**
 * `POST /admin/skills/:skillId/versions` —— #595 后台管理面最小闭环：编辑已导入 skill
 * 的内容，产出并发布一个新版本。
 *
 * 独立文件，不改 `skill.controller.ts`（文件头写着「coord-chat-e2e 同时在改那份文件」，
 * `agent-trial-run.controller.ts` 同样因此独立成新文件）。
 *
 * ⚠ 契约面是草案，尚未经人类签核 —— 见 `packages/contracts/src/wave2-runtime.ts`
 * `SkillVersionEditResult` 处的说明。
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { wave2Runtime as C } from "@repo/contracts";
import {
  editSkillVersionContent,
  EditSkillVersionContentError,
  SKILL_VERSION_EDIT_REPOSITORY,
  type SkillVersionEditRepository,
} from "../../application/skill/edit-skill-version-content";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type EditBody = ReturnType<typeof C.operations.editSkillVersionContent.in.parse>;

/**
 * 用例层拒绝码 → HTTP 状态。每个码保留自己的身份（`reasonCode`），不合并成笼统的 400
 * —— 与 `skill-url-import.controller.ts` 同一条纪律。
 */
const USE_CASE_STATUS: Record<string, HttpStatus> = {
  EDIT_NOT_ORG_ADMIN: HttpStatus.FORBIDDEN,
  EDIT_SKILL_NOT_FOUND: HttpStatus.NOT_FOUND,
  EDIT_CONTENT_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Controller()
export class SkillVersionEditController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_VERSION_EDIT_REPOSITORY) private readonly repository: SkillVersionEditRepository,
  ) {}

  @Post(C.operations.editSkillVersionContent.path)
  async edit(
    @CurrentPrincipal() principal: Principal,
    @Param("skillId") skillId: string,
    @Body(new ZodBodyPipe(C.operations.editSkillVersionContent.in)) body: EditBody,
  ) {
    assertPrincipal(principal);
    try {
      const result = await editSkillVersionContent(
        { orgId: principal.orgId, actorId: principal.userId, skillId, ...body },
        { identities: this.identities, repository: this.repository },
      );
      return C.operations.editSkillVersionContent.out.parse(result);
    } catch (error) {
      if (error instanceof EditSkillVersionContentError) {
        const status = USE_CASE_STATUS[error.code];
        if (status === HttpStatus.FORBIDDEN) throw new ForbiddenException({ reasonCode: error.code });
        if (status === HttpStatus.NOT_FOUND) throw new NotFoundException({ reasonCode: error.code });
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      throw error;
    }
  }
}
