/**
 * F33's two export routes. Protocol adaptation only -- every judgement is in `application`.
 *
 *   POST /projects/:projectId/export-jobs   contract `createExportJob`
 *   GET  /export-jobs/:jobId                contract `getExportJob`
 *
 * ⚠ There is no route here that streams the zip's bytes. `getExportJob.out.downloadUrl` is a
 * real string pointing at a real object in `ObjectStore` (see `export-artifacts.ts`), but
 * nothing in this controller (or anywhere else in this feature) redeems it -- that redemption
 * route is left for whichever feature wires this job's `downloadUrl` onto F32's isolated-origin
 * download machinery. Stated here rather than discovered as a 404 later.
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import {
  createExportJob,
  getExportJob,
  FilesExportError,
  type CreateExportJobResult,
  type ExportDeps,
  type GetExportJobResult,
} from "../../application/files/export-artifacts";
import {
  EXPORT_CONTENT_REPOSITORY,
  EXPORT_JOB_REPOSITORY,
  ZIP_BUILDER,
  type ExportContentRepository,
  type ExportJobRepository,
  type ZipBuilder,
} from "../../application/files/export-ports";
import { DOWNLOAD_URL_BUILDER, type DownloadUrlBuilder } from "../../application/files/download-ports";
import { OBJECT_STORE, type ObjectStore, ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const CREATE_EXPORT_JOB_SCHEMA = C.operations.createExportJob.in;
export const GET_EXPORT_JOB_SCHEMA = C.operations.getExportJob.in;

type CreateExportJobBody = z.infer<typeof CREATE_EXPORT_JOB_SCHEMA>;

@Controller()
export class FilesExportController {
  constructor(
    @Inject(EXPORT_CONTENT_REPOSITORY) private readonly exportContent: ExportContentRepository,
    @Inject(EXPORT_JOB_REPOSITORY) private readonly jobs: ExportJobRepository,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    @Inject(DOWNLOAD_URL_BUILDER) private readonly urls: DownloadUrlBuilder,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly idFactory: IdFactory,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(ZIP_BUILDER) private readonly zip: ZipBuilder,
  ) {}

  private get deps(): ExportDeps {
    return {
      repo: this.repo,
      ids: this.ids,
      exportContent: this.exportContent,
      objectStore: this.objectStore,
      jobs: this.jobs,
      urls: this.urls,
      provenance: this.provenance,
      idFactory: this.idFactory,
      zip: this.zip,
      now: () => new Date(),
    };
  }

  @Post("/projects/:projectId/export-jobs")
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(CREATE_EXPORT_JOB_SCHEMA)) body: CreateExportJobBody,
  ): Promise<CreateExportJobResult> {
    assertPrincipal(principal);
    // Same discipline as `advance`/`bind`-style routes elsewhere in this controller set: the
    // route param is the resource, the body is what the contract validates, and a mismatch
    // between the two is rejected rather than silently resolved by picking one -- otherwise the
    // audit trail (`provenance.append` below) could record a different project than the one the
    // caller thought they were exporting.
    if (body.projectId !== projectId) {
      throw new BadRequestException("project_id_mismatch");
    }
    const input = CREATE_EXPORT_JOB_SCHEMA.parse(body);
    return this.mapErrors(() =>
      createExportJob(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId: input.projectId,
        artifactIds: input.artifactIds,
        treeNodeId: input.treeNodeId,
      }),
    );
  }

  @Get("/export-jobs/:jobId")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("jobId") jobId: string,
  ): Promise<GetExportJobResult> {
    assertPrincipal(principal);
    const input = GET_EXPORT_JOB_SCHEMA.parse({ jobId });
    return this.mapErrors(() =>
      getExportJob(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        jobId: input.jobId,
      }),
    );
  }

  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof FilesExportError)) throw e;
      switch (e.reasonCode) {
        case "NO_PROJECT_ROLE":
          throw new ForbiddenException({ reasonCode: e.reasonCode });
        // 400, not 403: the requester IS allowed to export, the SELECTION is too big. E2·22-1
        // ("拒绝，不静默截断") is a rejection of the request shape, same class as every other
        // "your input was too large" answer in this controller set (`BadRequestException`).
        case "EXPORT_LIMIT_EXCEEDED":
          throw new BadRequestException({ reasonCode: e.reasonCode });
        case "DEPENDENCY_UNAVAILABLE":
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
      }
    }
  }
}
