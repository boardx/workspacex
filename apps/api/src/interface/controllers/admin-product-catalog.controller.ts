import {
  BadRequestException, Body, ConflictException, Controller, Get, Header, Inject,
  NotFoundException, Patch, Query, ServiceUnavailableException, UseGuards,
} from "@nestjs/common";
import { adminCatalogOperations, adminWelcomeCreditOperations } from "@repo/contracts/billing-pricing";
import type { z } from "zod";
import type { Principal } from "../../domain/principal";
import {
  CatalogProductConflict, CatalogProductInvalid, CatalogProductMissing, CatalogWriterUnavailable, AdminProductCatalog,
} from "../../application/billing/admin-product-catalog";
import { CurrentPrincipal } from "../current-principal.decorator";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

@Controller()
@UseGuards(PlatformOperatorGuard)
export class AdminProductCatalogController {
  constructor(@Inject(AdminProductCatalog) private readonly catalog: AdminProductCatalog) {}

  @Get(adminCatalogOperations.list.path)
  @Header("Cache-Control", "private, no-store")
  list(@Query(new ZodBodyPipe(adminCatalogOperations.list.in)) query: z.infer<typeof adminCatalogOperations.list.in>) {
    return this.catalog.list(query.market);
  }

  @Get(adminWelcomeCreditOperations.list.path)
  @Header("Cache-Control", "private, no-store")
  welcomePolicy(@Query(new ZodBodyPipe(adminWelcomeCreditOperations.list.in)) input: z.infer<typeof adminWelcomeCreditOperations.list.in>) {
    return this.catalog.welcomePolicy(input.market);
  }

  @Patch(adminWelcomeCreditOperations.update.path)
  updateWelcomePolicy(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(adminWelcomeCreditOperations.update.in)) input: z.infer<typeof adminWelcomeCreditOperations.update.in>,
  ) {
    return this.mapWrite(() => this.catalog.updateWelcomePolicy(principal.userId, input));
  }

  @Patch(adminCatalogOperations.update.path)
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(adminCatalogOperations.update.in)) input: z.infer<typeof adminCatalogOperations.update.in>,
  ) {
    return this.mapWrite(() => this.catalog.update(principal.userId, input));
  }

  private async mapWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CatalogProductMissing) throw new NotFoundException("catalog_product_missing");
      if (error instanceof CatalogProductConflict) throw new ConflictException("catalog_product_changed");
      if (error instanceof CatalogProductInvalid) throw new BadRequestException("catalog_product_invalid");
      if (error instanceof CatalogWriterUnavailable) throw new ServiceUnavailableException("catalog_writer_unavailable");
      throw error;
    }
  }
}
