import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Inject,
  UseGuards,
} from "@nestjs/common";
import * as C from "@repo/contracts/ai-catalog-admin";
import { z } from "zod";
import type { Principal } from "../../domain/principal";
import {
  AI_CATALOG_ADMIN_SERVICE,
  type AiCatalogAdminService,
} from "../../application/ai-catalog/admin-service";
import { CurrentPrincipal } from "../current-principal.decorator";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

const HttpLimit = z.preprocess(
  (value) => (typeof value === "string" ? Number(value) : value),
  C.List.shape.limit,
);
export const AI_CATALOG_LIST_QUERY = C.List.extend({ limit: HttpLimit });
export const AI_CATALOG_PUBLIC_QUERY = C.operations.listPublic.in.extend({
  limit: HttpLimit,
});

@Controller()
export class AiCatalogAdminController {
  constructor(
    @Inject(AI_CATALOG_ADMIN_SERVICE)
    private readonly service: AiCatalogAdminService,
  ) {}
  @UseGuards(PlatformOperatorGuard)
  @Get("/platform/ai-catalog")
  async list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodBodyPipe(AI_CATALOG_LIST_QUERY)) raw: z.infer<typeof C.List>,
  ) {
    return this.service.list(p, raw);
  }
  @UseGuards(PlatformOperatorGuard)
  @Get("/platform/organizations/:orgId/ai-catalog/:kind/:id")
  async detail(
    @Param("orgId") orgId: string,
    @Param("kind", new ZodBodyPipe(C.Kind)) raw: string,
    @Param("id") id: string,
    @Query(new ZodBodyPipe(C.operations.detail.in))
    query: z.infer<typeof C.operations.detail.in>,
  ) {
    return this.service.detail(orgId, raw, id, query);
  }
  @UseGuards(PlatformOperatorGuard)
  @Post("/platform/organizations/:orgId/ai-catalog")
  async create(
    @CurrentPrincipal() p: Principal,
    @Param("orgId") orgId: string,
    @Body(new ZodBodyPipe(C.Write)) body: z.infer<typeof C.Write>,
  ) {
    return this.service.create(p, orgId, body);
  }
  @UseGuards(PlatformOperatorGuard)
  @Patch("/platform/organizations/:orgId/ai-catalog/:kind/:id")
  async update(
    @CurrentPrincipal() p: Principal,
    @Param("orgId") orgId: string,
    @Param("kind", new ZodBodyPipe(C.Kind)) kind: string,
    @Param("id") id: string,
    @Body(new ZodBodyPipe(C.Write)) body: z.infer<typeof C.Write>,
  ) {
    return this.service.update(p, orgId, kind, id, body);
  }
  @UseGuards(PlatformOperatorGuard)
  @Post("/platform/organizations/:orgId/ai-catalog/:kind/:id/publish")
  async publish(
    @CurrentPrincipal() p: Principal,
    @Param("orgId") orgId: string,
    @Param("kind", new ZodBodyPipe(C.Kind)) raw: string,
    @Param("id") id: string,
  ) {
    return this.service.publish(p, orgId, raw, id);
  }
  @UseGuards(PlatformOperatorGuard)
  @Post("/platform/organizations/:orgId/ai-catalog/:kind/:id/disable")
  async disable(
    @CurrentPrincipal() p: Principal,
    @Param("orgId") orgId: string,
    @Param("kind", new ZodBodyPipe(C.Kind)) raw: string,
    @Param("id") id: string,
  ) {
    return this.service.disable(p, orgId, raw, id);
  }
  @Get("/organizations/:orgId/public-ai-catalog")
  async publicList(
    @CurrentPrincipal() p: Principal,
    @Param("orgId") orgId: string,
    @Query(new ZodBodyPipe(AI_CATALOG_PUBLIC_QUERY))
    raw: z.infer<typeof C.operations.listPublic.in>,
  ) {
    return this.service.publicList(p, orgId, raw);
  }
  @Post("/organizations/:orgId/public-ai-catalog/enable")
  async enable(
    @CurrentPrincipal() p: Principal,
    @Param("orgId") orgId: string,
    @Body(new ZodBodyPipe(C.Enable)) body: z.infer<typeof C.Enable>,
  ) {
    return this.service.enable(p, orgId, body);
  }
}
