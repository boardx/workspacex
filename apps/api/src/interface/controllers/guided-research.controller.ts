import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { research as C } from "@repo/contracts";
import {
  GUIDED_RESEARCH_SESSION_REPOSITORY,
  type GuidedResearchSessionRepository,
} from "../../application/research/guided-session-ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";
import { discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { decideGuidedResearchVisibility } from "../../domain/research/guided-research-visibility";
import { GuidedResearchCreateReplayMismatchError, InvalidGuidedResearchCollaboratorError, type GuardedGuidedResearchSession } from "../../application/research/guided-session-ports";
import { GuidedResearchCheckpointConflictError, GuidedResearchDirectionsNotConfirmedError } from "../../application/research/guided-session-ports";
import { GUIDED_RESEARCH_CHECKPOINT_GENERATOR, type GuidedResearchCheckpointGenerator } from "../../domain/research/guided-research-checkpoint-generator";

@Controller()
export class GuidedResearchController {
  constructor(
    @Inject(GUIDED_RESEARCH_SESSION_REPOSITORY)
    private readonly sessions: GuidedResearchSessionRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(GUIDED_RESEARCH_CHECKPOINT_GENERATOR) private readonly generator: GuidedResearchCheckpointGenerator,
  ) {}

  private disclose(row: GuardedGuidedResearchSession, viewerUserId: string) {
    const disclosed = discloseDecided(row.item, decideGuidedResearchVisibility({
      decisionId: this.decisions.next(), ownerUserId: row.ownerUserId, viewerUserId,
      isExplicitCollaborator: row.isExplicitCollaborator,
    }));
    return isDisclosed(disclosed) ? disclosed.payload : null;
  }

  @Post(C.operations.createGuidedResearchSession.path)
  async create(@CurrentPrincipal() principal: Principal, @Body() raw: unknown) {
    assertPrincipal(principal);
    const input = C.operations.createGuidedResearchSession.in.safeParse(raw);
    if (!input.success) throw new BadRequestException();
    let row: GuardedGuidedResearchSession;
    try {
      row = await this.sessions.create({ orgId: principal.orgId, ownerUserId: principal.userId, ...input.data });
    } catch (error) {
      if (error instanceof InvalidGuidedResearchCollaboratorError) {
        throw new BadRequestException({ reasonCode: error.reasonCode });
      }
      if (error instanceof GuidedResearchCreateReplayMismatchError) {
        throw new ConflictException({ reasonCode: error.reasonCode });
      }
      throw error;
    }
    const visible = this.disclose(row, principal.userId);
    if (!visible) throw new NotFoundException();
    return visible;
  }

  @Get(C.operations.listGuidedResearchSessions.path)
  async list(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const rows = await this.sessions.listVisible(principal.orgId, principal.userId);
    return { items: rows.flatMap((row) => {
      const visible = this.disclose(row, principal.userId);
      return visible ? [visible] : [];
    }) };
  }

  @Get(C.operations.getGuidedResearchSession.path)
  async get(@CurrentPrincipal() principal: Principal, @Param("sessionId") sessionId: string) {
    assertPrincipal(principal);
    const input = C.operations.getGuidedResearchSession.in.safeParse({ sessionId });
    if (!input.success) throw new BadRequestException();
    const found = await this.sessions.findVisible(principal.orgId, principal.userId, input.data.sessionId);
    if (!found) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
    const visible = this.disclose(found, principal.userId);
    if (!visible) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
    return visible;
  }

  private async current(principal: Principal, sessionId: string) {
    const found = await this.sessions.findVisible(principal.orgId, principal.userId, sessionId);
    if (!found) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
    const visible = this.disclose(found, principal.userId);
    if (!visible) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
    return visible;
  }

  private checkpointError(error: unknown): never {
    if (error instanceof GuidedResearchCheckpointConflictError || error instanceof GuidedResearchDirectionsNotConfirmedError) {
      throw new ConflictException({ reasonCode: error.reasonCode });
    }
    throw error;
  }

  @Post(C.operations.generateResearchDirections.path)
  async generateDirections(@CurrentPrincipal() principal: Principal, @Param("sessionId") sessionId: string) {
    assertPrincipal(principal);
    const input = C.operations.generateResearchDirections.in.safeParse({ sessionId });
    if (!input.success) throw new BadRequestException();
    const current = await this.current(principal, input.data.sessionId);
    const items = await this.generator.generateDirections(current.brief);
    try {
      const updated = await this.sessions.generateDirections({ orgId: principal.orgId, viewerUserId: principal.userId, sessionId, items });
      if (!updated) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
      return this.disclose(updated, principal.userId);
    } catch (error) { this.checkpointError(error); }
  }

  @Put(C.operations.confirmResearchDirections.path)
  async confirmDirections(@CurrentPrincipal() principal: Principal, @Param("sessionId") sessionId: string, @Body() raw: unknown) {
    assertPrincipal(principal);
    const input = C.operations.confirmResearchDirections.in.safeParse({ ...(raw as object), sessionId });
    if (!input.success) throw new BadRequestException();
    try {
      const updated = await this.sessions.confirmDirections({ orgId: principal.orgId, viewerUserId: principal.userId, sessionId, candidateVersion: input.data.candidateVersion, items: input.data.directions });
      if (!updated) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
      return this.disclose(updated, principal.userId);
    } catch (error) { this.checkpointError(error); }
  }

  @Post(C.operations.generateResearchOutline.path)
  async generateOutline(@CurrentPrincipal() principal: Principal, @Param("sessionId") sessionId: string) {
    assertPrincipal(principal);
    const current = await this.current(principal, sessionId);
    const confirmed = current.directions.versions.find((version) => version.version === current.directions.confirmedVersion);
    if (!confirmed) throw new ConflictException({ reasonCode: "RESEARCH_DIRECTIONS_NOT_CONFIRMED" });
    const items = await this.generator.generateOutline(confirmed.items);
    try {
      const updated = await this.sessions.generateOutline({ orgId: principal.orgId, viewerUserId: principal.userId, sessionId, items });
      if (!updated) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
      return this.disclose(updated, principal.userId);
    } catch (error) { this.checkpointError(error); }
  }

  @Put(C.operations.confirmResearchOutline.path)
  async confirmOutline(@CurrentPrincipal() principal: Principal, @Param("sessionId") sessionId: string, @Body() raw: unknown) {
    assertPrincipal(principal);
    const input = C.operations.confirmResearchOutline.in.safeParse({ ...(raw as object), sessionId });
    if (!input.success) throw new BadRequestException();
    try {
      const updated = await this.sessions.confirmOutline({ orgId: principal.orgId, viewerUserId: principal.userId, sessionId, candidateVersion: input.data.candidateVersion, items: input.data.outline });
      if (!updated) throw new NotFoundException({ reasonCode: "RESEARCH_NOT_FOUND" });
      return this.disclose(updated, principal.userId);
    } catch (error) { this.checkpointError(error); }
  }
}
