import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Patch, Query } from "@nestjs/common";
import { ExpertAvatarContext, SaveExpertAvatarPreference, SaveInterviewExpertAvatarPreference } from "@repo/contracts/interview-expert-avatar";
import { EXPERT_AVATAR_PREFERENCE_REPOSITORY, ExpertAvatarSourceAccessError, ExpertAvatarSourceRevisionConflictError, type ExpertAvatarPreferenceRepository, type StoredExpertAvatarPreference } from "../../application/interview/expert-avatar-preference.port";
import { DIGITAL_INTERVIEW_REPOSITORY, type DigitalInterviewRepository } from "../../application/interview/digital-interview-ports";
import { toOrgId } from "../../domain/org-id";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { INTERVIEW_SCOPE_REPOSITORY, type InterviewScopeRepository } from "../../application/interview/ports";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";
import { discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import type { OrgRole } from "../../domain/identity/roles";
import { INTERVIEW_MARKDOWN_READER, readInterviewMarkdown, type InterviewMarkdownReader } from "../../application/interview/read-interview-markdown";
import { NoInterviewAccessError } from "../../application/interview/errors";

@Controller("/interviews/digital")
export class ExpertAvatarPreferenceController {
  constructor(
    @Inject(EXPERT_AVATAR_PREFERENCE_REPOSITORY) private readonly preferences: ExpertAvatarPreferenceRepository,
    @Inject(DIGITAL_INTERVIEW_REPOSITORY) private readonly experts: DigitalInterviewRepository,
    @Inject(INTERVIEW_SCOPE_REPOSITORY) private readonly membership: InterviewScopeRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(INTERVIEW_MARKDOWN_READER) private readonly reader: InterviewMarkdownReader,
  ) {}
  private async scope(principal: Principal, expertId: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const membership = await this.membership.orgMembershipOf(orgId, principal.userId);
    if (membership.orgRole === null) throw new NotFoundException();
    const visible = await this.experts.listVisibleExperts({ orgId, viewerUserId: principal.userId });
    if (!visible.some((expert) => expert.expertId === expertId)) throw new NotFoundException();
    return { orgId, actorId: principal.userId, expertId, membership };
  }
  private disclose(stored: StoredExpertAvatarPreference, scope: Awaited<ReturnType<ExpertAvatarPreferenceController["scope"]>>) {
    const orgPassed = stored.orgId === scope.orgId && scope.membership.orgRole !== null;
    const visible = orgPassed && stored.actorId === scope.actorId;
    const disclosed = discloseDecided(stored.item, {
      allowed: visible,
      orgLayer: { role: scope.membership.orgRole as OrgRole | null, teamId: scope.membership.teamId, passed: orgPassed },
      projectLayer: null,
      scopeLayer: { scope: "org-wide", passed: visible },
      reasonCode: visible ? null : orgPassed ? "ORG_SCOPE_DENIED" : "NO_ORG_MEMBERSHIP",
      decisionId: this.decisions.next(),
    });
    if (!isDisclosed(disclosed)) throw new NotFoundException();
    return disclosed.payload;
  }
  @Get("/experts/:expertId/avatar")
  async read(@CurrentPrincipal() principal: Principal, @Param("expertId") expertId: string) {
    const scope = await this.scope(principal, expertId);
    return this.disclose(await this.preferences.read(scope), scope);
  }
  @Patch("/experts/:expertId/avatar")
  async save(@CurrentPrincipal() principal: Principal, @Param("expertId") expertId: string, @Body() body: unknown) {
    const scope = await this.scope(principal, expertId);
    const parsed = SaveExpertAvatarPreference.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const saved = await this.preferences.save({ ...scope, ...parsed.data });
    if (!saved) throw new ConflictException("AVATAR_VERSION_CONFLICT");
    return this.disclose(saved, scope);
  }
  private async sourceScope(principal: Principal, interviewId: string, expertId: string, revisionId: string) {
    assertPrincipal(principal);
    const context = ExpertAvatarContext.safeParse({ interviewId, revisionId });
    if (!context.success) throw new BadRequestException();
    const orgId = toOrgId(principal.orgId);
    const current = await readInterviewMarkdown({ repo: this.experts, scope: this.membership, decisions: this.decisions, reader: this.reader },
      { orgId, viewerUserId: principal.userId, interviewId });
    if (current.revisionId !== revisionId) throw new ExpertAvatarSourceRevisionConflictError();
    const membership = await this.membership.orgMembershipOf(orgId, principal.userId);
    return { orgId, actorId: principal.userId, expertId, interviewId, revisionId, membership };
  }
  private translateSource(error: unknown): never {
    if (error instanceof NoInterviewAccessError || error instanceof ExpertAvatarSourceAccessError) throw new NotFoundException();
    if (error instanceof ExpertAvatarSourceRevisionConflictError) throw new ConflictException("AVATAR_REVISION_CONFLICT");
    throw error;
  }
  @Get("/:interviewId/markdown/experts/:expertId/avatar")
  async readSource(@CurrentPrincipal() principal: Principal, @Param("interviewId") interviewId: string, @Param("expertId") expertId: string, @Query("revisionId") revisionId: string) {
    try {
      const scope = await this.sourceScope(principal, interviewId, expertId, revisionId);
      return this.disclose(await this.preferences.read(scope), scope);
    } catch (error) { return this.translateSource(error); }
  }
  @Patch("/:interviewId/markdown/experts/:expertId/avatar")
  async saveSource(@CurrentPrincipal() principal: Principal, @Param("interviewId") interviewId: string, @Param("expertId") expertId: string, @Body() body: unknown) {
    const parsed = SaveInterviewExpertAvatarPreference.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const scope = await this.sourceScope(principal, interviewId, expertId, parsed.data.revisionId);
      const saved = await this.preferences.save({ ...scope, avatarKey: parsed.data.avatarKey, expectedVersion: parsed.data.expectedVersion });
      if (!saved) throw new ConflictException("AVATAR_VERSION_CONFLICT");
      return this.disclose(saved, scope);
    } catch (error) { return this.translateSource(error); }
  }
}
