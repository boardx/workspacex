/**
 * issue #652 — F46's `getRetentionPolicy` / `setRetentionPolicy` had a use case, a real
 * PostgreSQL repository (`PgRetentionPolicyRepository`, `retention_policies`), and even a
 * consumer (the 05-rec bundle's retention resolver, wired in `kernel.module.ts`,
 * reads the SAME repository instance) — but zero HTTP entry. From a real user's browser there was no
 * way to ever populate `retention_policies` for a project, so `startRecording`'s
 * `RETENTION_POLICY_MISSING` gate could only ever be satisfied by a CI seed script, never by
 * a project owner clicking anything.
 *
 * This controller is protocol adaptation only, same shape as `files-rename.controller.ts`:
 * every judgement (D-14's "组织默认由管理员配；项目级覆盖由项目负责人配", `RETENTION_PARAM_INVALID`)
 * already lives in `application/files/{get,set}-retention-policy.ts`.
 */
import {
  Body, Controller, ForbiddenException, Get, Inject, Put, Query, UnprocessableEntityException,
} from "@nestjs/common";
import { files as C } from "@repo/contracts";
import {
  DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository,
} from "../../application/identity/ports";
import {
  RETENTION_POLICY_REPOSITORY, type RetentionPolicyRepository,
} from "../../application/files/retention-policy-ports";
import {
  getRetentionPolicy, GetRetentionPolicyError, type GetRetentionPolicyResult,
} from "../../application/files/get-retention-policy";
import {
  setRetentionPolicy, SetRetentionPolicyError, type SetRetentionPolicyResult,
} from "../../application/files/set-retention-policy";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type SetBody = typeof C.operations.setRetentionPolicy.in._type;

@Controller()
export class FilesRetentionController {
  constructor(
    @Inject(RETENTION_POLICY_REPOSITORY) private readonly retention: RetentionPolicyRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  @Get("/retention-policy")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Query("projectId") projectId: string | undefined,
  ): Promise<GetRetentionPolicyResult> {
    assertPrincipal(principal);
    try {
      return await getRetentionPolicy(
        { repo: this.repo, ids: this.ids, retention: this.retention, defaults: C.DEFAULT_RETENTION_PARAMS },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), projectId: projectId ?? null },
      );
    } catch (e) {
      if (e instanceof GetRetentionPolicyError) throw new ForbiddenException({ reasonCode: e.reasonCode });
      throw e;
    }
  }

  @Put("/retention-policy")
  async set(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.setRetentionPolicy.in)) body: SetBody,
  ): Promise<SetRetentionPolicyResult> {
    assertPrincipal(principal);
    try {
      return await setRetentionPolicy(
        { repo: this.repo, ids: this.ids, retention: this.retention, defaults: C.DEFAULT_RETENTION_PARAMS },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          projectId: body.projectId,
          params: body.params,
        },
      );
    } catch (e) {
      if (e instanceof SetRetentionPolicyError) {
        if (e.reasonCode === "PROJECT_ROLE_INSUFFICIENT") throw new ForbiddenException({ reasonCode: e.reasonCode });
        throw new UnprocessableEntityException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
