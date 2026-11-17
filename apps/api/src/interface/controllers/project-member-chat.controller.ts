/** Protocol adapter for the optional pure-human channel. No Chat/Agent runtime dependency. */
import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, UnauthorizedException } from "@nestjs/common";
import { operations as C } from "@repo/contracts/project-member-chat";
import type { z, ZodTypeAny } from "zod";
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { PROJECT_MEMBER_CHAT_REPOSITORY, type ProjectMemberChatRepository } from "../../application/project-member-chat/ports";
import { listMemberMessages, listMemberReplies, postMemberMessage, type ProjectMemberChatDeps } from "../../application/project-member-chat/service";
import { ProjectMemberChatError } from "../../domain/project-member-chat/errors";
import type { Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

/** Environment opt-in is deliberately independent from the teaching UI flag. */
export function projectMemberChatEnabled(): boolean {
  return process.env.ENABLE_PROJECT_MEMBER_CHAT === "1" || process.env.ENABLE_PROJECT_MEMBER_CHAT === "true";
}
function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProjectMemberChatError("INVALID_INPUT");
  return result.data;
}
function queryInput(query: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) =>
    [key, ["beforeSequence", "afterSequence", "limit"].includes(key) && typeof value === "string" ? Number(value) : value]));
}
@Controller("projects/:projectId/member-chat/messages")
export class ProjectMemberChatController {
  private readonly deps: ProjectMemberChatDeps;
  constructor(@Inject(DATABASE_PORT) db: DatabasePort,
    @Inject(IDENTITY_REPOSITORY) identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) decisions: DecisionIdFactory,
    @Inject(PROJECT_MEMBER_CHAT_REPOSITORY) repo: ProjectMemberChatRepository) {
    this.deps = { db, repo, auth: { repo: identity, ids: decisions }, enabled: projectMemberChatEnabled };
  }
  private async respond<T>(principal: Principal | undefined, action: (principal: Principal) => Promise<T>): Promise<T> {
    if (!principal?.userId || !principal.orgId) throw new UnauthorizedException();
    try { return await action(principal); }
    catch (error) {
      if (!(error instanceof ProjectMemberChatError)) throw error;
      const reason = error.reason;
      const status = reason === "MODULE_DISABLED" || reason === "NOT_FOUND" ? 404
        : reason.startsWith("READ_ONLY_") ? 403 : reason === "IDEMPOTENCY_CONFLICT" ? 409
          : reason === "MESSAGE_TOO_LARGE" ? 413 : reason === "DEPENDENCY_UNAVAILABLE" ? 503 : 422;
      throw new HttpException({ reasonCode: reason }, status);
    }
  }
  @Get()
  list(@Param("projectId") projectId: string, @Query() query: Record<string, unknown>, @CurrentPrincipal() principal: Principal) {
    return this.respond(principal, p => listMemberMessages(this.deps, { ...p, projectId }, parse(C.listMessages.in, { ...queryInput(query), projectId })));
  }
  @Post()
  post(@Param("projectId") projectId: string, @Body() body: unknown, @CurrentPrincipal() principal: Principal) {
    return this.respond(principal, p => {
      if (typeof body === "object" && body !== null && "text" in body && typeof body.text === "string" && body.text.trim().length > 4000)
        throw new ProjectMemberChatError("MESSAGE_TOO_LARGE");
      const input = parse(C.postMessage.in, { ...(typeof body === "object" && body !== null ? body : {}), projectId });
      return postMemberMessage(this.deps, { ...p, projectId }, input);
    });
  }
  @Get(":threadRootId/replies")
  replies(@Param("projectId") projectId: string, @Param("threadRootId") threadRootId: string,
    @Query() query: Record<string, unknown>, @CurrentPrincipal() principal: Principal) {
    return this.respond(principal, p => listMemberReplies(this.deps, { ...p, projectId },
      parse(C.listReplies.in, { ...queryInput(query), projectId, threadRootId })));
  }
}
