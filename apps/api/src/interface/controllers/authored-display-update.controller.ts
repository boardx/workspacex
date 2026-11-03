import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Post, UnprocessableEntityException } from "@nestjs/common";
import { operations } from "@repo/contracts/portable-package";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { AUTHORED_DISPLAY_UPDATE_REPOSITORY, getAuthoredDisplayUpdateOffer, applyAuthoredDisplayUpdate, type AuthoredDisplayUpdateRepository } from "../../application/localization/authored-display-update";
import { EntityLocalizationError } from "../../application/localization/entity-localization";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
@Controller()
export class AuthoredDisplayUpdateController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(AUTHORED_DISPLAY_UPDATE_REPOSITORY) private readonly repository: AuthoredDisplayUpdateRepository,
  ) {}
  private async run<T>(fn: () => Promise<T>) {
    try { return await fn(); }
    catch (error) {
      if (!(error instanceof EntityLocalizationError)) throw error;
      if (error.code === "ROLE_INSUFFICIENT") throw new ForbiddenException({ reasonCode: error.code });
      if (error.code === "SOURCE_CHANGED") throw new ConflictException({ reasonCode: error.code });
      throw new UnprocessableEntityException({ reasonCode: error.code });
    }
  }
  @Get(operations.displayUpdateOffer.path)
  offer(@CurrentPrincipal() p: Principal) {
    assertPrincipal(p);
    return this.run(async () => operations.displayUpdateOffer.out.parse(await getAuthoredDisplayUpdateOffer({ orgId: p.orgId,actorId: p.userId }, { identities: this.identities,repository: this.repository })));
  }
  @Post(operations.applyDisplayUpdate.path)
  @HttpCode(200)
  apply(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    assertPrincipal(p);
    return this.run(async () => operations.applyDisplayUpdate.out.parse(await applyAuthoredDisplayUpdate({ orgId: p.orgId,actorId: p.userId,body }, { identities: this.identities,repository: this.repository })));
  }
}
