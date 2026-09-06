import { BadRequestException, ConflictException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { artifactsSteering as AS } from "@repo/contracts";
import { ARTIFACT_STORE, ARTIFACT_RUN_LAUNCHER, type ArtifactStore, type ArtifactRunLauncher } from "../../application/artifacts-steering/ports";
import { getArtifact, listArtifactVersions } from "../../application/artifacts-steering/read-artifact";
import { continueArtifact } from "../../application/artifacts-steering/continue-artifact";
import { ArtifactNotFoundError, ArtifactNotVisibleError, ArtifactVersionNotFoundError } from "../../application/artifacts-steering/errors";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY, type IdentityRepository, type DecisionIdFactory } from "../../application/identity/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { OBJECT_STORE, type ObjectStore } from "../../application/artifact/ports";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { MessageIdempotencyConflictError } from "../../application/chat/message-roundtrip";
import { getThread } from "../../application/chat/get-thread";

@Controller()
export class AgentArtifactController {
  constructor(@Inject(ARTIFACT_STORE) private readonly artifacts: ArtifactStore,
    @Inject(ARTIFACT_RUN_LAUNCHER) private readonly launcher: ArtifactRunLauncher,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore) {}
  private get deps() { return { artifacts: this.artifacts, launcher: this.launcher, repo: this.repo, ids: this.ids, chat: this.chat }; }
  private publicVersion(artifactId: string, version: AS.ArtifactVersionInfo) {
    const { storageKey: _storageKey, ...metadata } = version;
    return { ...metadata, contentUrl: `/artifacts/${encodeURIComponent(artifactId)}/versions/${version.version}/content` };
  }
  private publicRecord(artifact: AS.ArtifactRecord) {
    return { ...artifact,versions: artifact.versions.map(version => this.publicVersion(artifact.artifactId,version)) };
  }
  private async visible<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (error) {
      if (error instanceof MessageIdempotencyConflictError) throw new ConflictException("artifact_continuation_idempotency_conflict");
      if (error instanceof ArtifactNotFoundError || error instanceof ArtifactNotVisibleError || error instanceof ArtifactVersionNotFoundError) {
        throw new NotFoundException("artifact_not_found");
      }
      throw error;
    }
  }

  @Get("/agent-artifacts/threads/:threadId")
  async list(@CurrentPrincipal() principal: Principal, @Param("threadId") threadId: string, @Query("projectId") projectId?: string) {
    assertPrincipal(principal);
    const input = { orgId: toOrgId(principal.orgId), userId: principal.userId,threadId,projectId: projectId || null };
    await getThread(this.deps,input);
    const ids = await this.artifacts.listByThread?.(input.orgId,threadId) ?? [];
    const records = await Promise.all(ids.map(async artifactId => {
      try { return this.publicRecord(await getArtifact(this.deps,{...input,artifactId})); }
      catch (error) {
        if (error instanceof ArtifactNotVisibleError || error instanceof ArtifactNotFoundError) return null;
        throw error;
      }
    }));
    return {artifacts: records.filter(record => record !== null)};
  }
  @Get("/artifacts/:artifactId")
  async get(@CurrentPrincipal() principal: Principal, @Param("artifactId") artifactId: string) {
    assertPrincipal(principal);
    return this.publicRecord(await this.visible(() => getArtifact(this.deps,{ orgId: toOrgId(principal.orgId), userId: principal.userId,artifactId })));
  }
  @Get("/artifacts/:artifactId/versions")
  async versions(@CurrentPrincipal() principal: Principal, @Param("artifactId") artifactId: string,
    @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    assertPrincipal(principal);
    const parsed = AS.ListArtifactVersionsInput.safeParse({ artifactId,cursor: cursor ?? null,limit: limit ? Number(limit) : 20 });
    if (!parsed.success) throw new BadRequestException("invalid_artifact_versions_query");
    const result = await this.visible(() => listArtifactVersions(this.deps,{ orgId: toOrgId(principal.orgId),userId: principal.userId,...parsed.data }));
    return { ...result, versions: result.versions.map(version => this.publicVersion(artifactId,version)) };
  }
  @Post("/artifacts/:artifactId/continue")
  async continue(@CurrentPrincipal() principal: Principal, @Param("artifactId") artifactId: string, @Body() body: unknown) {
    assertPrincipal(principal);
    const parsed = AS.ContinueArtifactInput.safeParse({ ...(body as object),artifactId });
    if (!parsed.success) throw new BadRequestException("invalid_artifact_continuation");
    return this.visible(() => continueArtifact(this.deps,{ orgId: toOrgId(principal.orgId),userId: principal.userId,...parsed.data }));
  }
  @Get("/artifacts/:artifactId/versions/:version/content")
  async content(@CurrentPrincipal() principal: Principal, @Param("artifactId") artifactId: string,
    @Param("version") version: string, @Res() response: Response) {
    assertPrincipal(principal);
    const artifact = await this.visible(() => getArtifact(this.deps,{ orgId: toOrgId(principal.orgId),userId: principal.userId,artifactId }));
    const selected = artifact.versions.find(item => item.version === Number(version));
    if (!selected) throw new NotFoundException("artifact_version_not_found");
    const metadata = await this.objects.head(selected.storageKey);
    const bytes = await this.objects.get(selected.storageKey);
    if (!metadata || !bytes) throw new NotFoundException("artifact_content_not_found");
    response.setHeader("Content-Type",metadata.mime);
    response.setHeader("X-Content-Type-Options","nosniff");
    response.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`);
    response.send(Buffer.from(bytes));
  }
}
