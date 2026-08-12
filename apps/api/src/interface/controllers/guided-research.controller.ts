import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post } from "@nestjs/common";
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
import { InvalidGuidedResearchCollaboratorError, type GuardedGuidedResearchSession } from "../../application/research/guided-session-ports";

@Controller()
export class GuidedResearchController {
  constructor(
    @Inject(GUIDED_RESEARCH_SESSION_REPOSITORY)
    private readonly sessions: GuidedResearchSessionRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
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
}
