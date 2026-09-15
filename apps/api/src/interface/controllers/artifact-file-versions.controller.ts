/**
 * `GET /artifacts/:artifactId/file-versions` —— 契约 `files.operations.listVersions`。
 * 协议适配而已，每一条判断都在 `application/files/list-artifact-file-versions.ts`。
 *
 * ⚠ 路由是 `/file-versions` 不是 `/versions`：`/artifacts/:artifactId/versions` 已经被
 *   `agent-artifact.controller.ts`（`artifacts-steering` 束）占掉了。契约里
 *   `uploadNewVersion` 的注释逐字写了这条冲突，本控制器照它落。
 *
 * ⚠ 拒绝 = **裸 404**，与「真的不存在」逐字同响应（`files.FilesError.ARTIFACT_NOT_FOUND`
 *   的契约加严 / N-25）：不带 `reasonCode`，同 `files-delivery.controller.ts` 的既有做法。
 *   应用层本来就只有一种错误类，这里没有可泄露的区分。
 */
import { Controller, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import { files as C } from "@repo/contracts";
import {
  ArtifactFileVersionsNotFoundError,
  listArtifactFileVersions,
} from "../../application/files/list-artifact-file-versions";
import {
  ARTIFACT_LANDING_REPOSITORY,
  type ArtifactLandingRepository,
} from "../../application/chat/artifact-landing-ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { ARTIFACT_REPOSITORY, type ArtifactRepository } from "../../application/artifact/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const LIST_FILE_VERSIONS_SCHEMA = C.operations.listVersions.in;

@Controller()
export class ArtifactFileVersionsController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(ARTIFACT_LANDING_REPOSITORY) private readonly landings: ArtifactLandingRepository,
    @Inject(ARTIFACT_REPOSITORY) private readonly artifacts: ArtifactRepository,
  ) {}

  @Get("/artifacts/:artifactId/file-versions")
  async listVersionsRoute(
    @CurrentPrincipal() principal: Principal,
    @Param("artifactId") artifactId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await listArtifactFileVersions(
        {
          repo: this.repo,
          ids: this.ids,
          chat: this.chat,
          landings: this.landings,
          artifacts: this.artifacts,
        },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), artifactId },
      );
    } catch (e) {
      if (e instanceof ArtifactFileVersionsNotFoundError) throw new NotFoundException();
      throw e;
    }
  }
}
