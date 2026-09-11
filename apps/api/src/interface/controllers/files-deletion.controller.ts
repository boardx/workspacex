import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { files as C } from "@repo/contracts";
import { DELETION_HTTP_DEPS, type DeletionHttpDeps } from "../../application/files/deletion-http-deps";
import { previewDeleteImpact, PreviewDeleteImpactError } from "../../application/files/preview-delete-impact";
import { requestDeletion, RequestDeletionError } from "../../application/files/request-deletion";
import { readDeletionStatus, readAuthorizedDeletionReceipt, DeletionStatusDeniedError } from "../../application/files/read-deletion-status";
import { GetDeletionReceiptError } from "../../application/files/get-deletion-receipt";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class FilesDeletionController {
  constructor(@Inject(DELETION_HTTP_DEPS) private readonly deps: DeletionHttpDeps) {}
  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (error) {
      if (error instanceof DeletionStatusDeniedError) throw new ForbiddenException({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
      if (error instanceof RequestDeletionError || error instanceof PreviewDeleteImpactError || error instanceof GetDeletionReceiptError) {
        if (error.reasonCode === "DEPENDENCY_UNAVAILABLE") throw new ServiceUnavailableException({ reasonCode: error.reasonCode });
        if (error.reasonCode === "ARTIFACT_NOT_FOUND") throw new NotFoundException({ reasonCode: error.reasonCode });
        throw new ForbiddenException({ reasonCode: error.reasonCode });
      }
      throw error;
    }
  }
  @Get("/artifacts/:artifactId/delete-impact")
  async preview(@CurrentPrincipal() principal: Principal, @Param("artifactId") artifactId: string) {
    assertPrincipal(principal);
    const input = C.operations.previewDeleteImpact.in.parse({ artifactId });
    return this.guarded(() => previewDeleteImpact(this.deps, { ...principal, ...input, actorKind: "user" }));
  }
  @Post("/artifacts/:artifactId/deletion-requests")
  async request(@CurrentPrincipal() principal: Principal, @Param("artifactId") artifactId: string, @Body() body: unknown) {
    assertPrincipal(principal);
    if (body && typeof body === "object" && "artifactId" in body && body.artifactId !== artifactId) throw new BadRequestException("artifact_id_mismatch");
    const input = C.operations.requestDeletion.in.parse({ ...(body as object), artifactId });
    // T-8 has no approved partial-withdrawal mapping. Never turn a scoped request into
    // full deletion merely because the existing use case accepts a nullable string.
    if (input.scope !== null) throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    return this.guarded(() => this.deps.transaction(principal.orgId,
      () => requestDeletion({ ...this.deps, invalidateOntologyEdges: this.deps.ontologyEdgesForOrg(principal.orgId) },
        { ...principal, ...input, actorKind: "user" })));
  }
  @Get("/deletion-tasks/:taskId")
  async task(@CurrentPrincipal() principal: Principal, @Param("taskId") taskId: string) {
    assertPrincipal(principal);
    const input = C.operations.getDeletionTask.in.parse({ taskId });
    return this.guarded(() => readDeletionStatus(this.deps, { ...principal, ...input }));
  }
  @Get("/deletion-tasks/:taskId/receipt")
  async receipt(@CurrentPrincipal() principal: Principal, @Param("taskId") taskId: string) {
    assertPrincipal(principal);
    const input = C.operations.getDeletionReceipt.in.parse({ taskId });
    return this.guarded(() => readAuthorizedDeletionReceipt(this.deps, { ...principal, ...input }));
  }
}
