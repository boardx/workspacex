import { BadRequestException, Controller, Get, Inject, Query } from "@nestjs/common";
import { interview as C } from "@repo/contracts";
import {
  DIGITAL_INTERVIEW_REPOSITORY,
  type DigitalInterviewRepository,
} from "../../application/interview/digital-interview-ports";
import {
  listDigitalExperts,
  listDigitalInterviews,
} from "../../application/interview/list-digital-interviews";
import type { DigitalInterviewStatusName } from "../../domain/interview/digital-interview";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { INTERVIEW_SCOPE_REPOSITORY, type InterviewScopeRepository } from "../../application/interview/ports";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";

@Controller("/interviews/digital")
export class DigitalInterviewController {
  constructor(
    @Inject(DIGITAL_INTERVIEW_REPOSITORY) private readonly repo: DigitalInterviewRepository,
    @Inject(INTERVIEW_SCOPE_REPOSITORY) private readonly scope: InterviewScopeRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
  ) {}

  @Get("/experts")
  async experts(
    @CurrentPrincipal() principal: Principal,
    @Query("domain") domain?: string,
  ) {
    assertPrincipal(principal);
    const parsed = C.operations.listDigitalExperts.in.safeParse({
      ...(domain === undefined || domain === "" ? {} : { domain }),
    });
    if (!parsed.success) throw new BadRequestException();
    return listDigitalExperts(this.repo, {
      orgId: principal.orgId,
      viewerUserId: principal.userId,
      ...parsed.data,
    });
  }

  @Get()
  async history(
    @CurrentPrincipal() principal: Principal,
    @Query("status") status?: string,
  ) {
    assertPrincipal(principal);
    const parsed = C.operations.listDigitalInterviews.in.safeParse({
      ...(status === undefined || status === "" ? {} : { status }),
    });
    if (!parsed.success) throw new BadRequestException();
    return listDigitalInterviews({ repo: this.repo, scope: this.scope, decisions: this.decisions }, {
      orgId: principal.orgId,
      viewerUserId: principal.userId,
      ...(parsed.data.status === undefined ? {} : {
        status: parsed.data.status as DigitalInterviewStatusName,
      }),
    });
  }
}
