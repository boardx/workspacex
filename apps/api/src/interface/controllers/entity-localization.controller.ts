import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Put, UnprocessableEntityException } from "@nestjs/common";
import { EntityDisplaySource, operations, type EntityKind } from "@repo/contracts/entity-localization";
import { Locale } from "@repo/contracts/locale";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import {
  ENTITY_LOCALIZATION_REPOSITORY, EntityLocalizationError,
  getLocalizationAdmin, putLocalization, clearLocalization, setLocalizationSourceLocale,
  type EntityLocalizationRepository,
} from "../../application/localization/entity-localization";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class EntityLocalizationController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(ENTITY_LOCALIZATION_REPOSITORY) private readonly repository: EntityLocalizationRepository,
  ) {}
  private get deps() { return { identities: this.identities, repository: this.repository }; }
  private identityTarget(kind: EntityKind, principal: Principal, entityId: string) {
    assertPrincipal(principal);
    if (!EntityDisplaySource.shape.entityId.safeParse(entityId).success) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
    return { kind, orgId: principal.orgId, actorId: principal.userId, entityId };
  }
  private target(kind: EntityKind, principal: Principal, entityId: string, locale: string) {
    const target = this.identityTarget(kind, principal, entityId);
    const parsed = Locale.safeParse(locale);
    if (!parsed.success) {
      throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
    }
    return { ...target, locale: parsed.data };
  }
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (error) {
      if (!(error instanceof EntityLocalizationError)) throw error;
      const body = { reasonCode: error.code };
      switch (error.code) {
        case "ROLE_INSUFFICIENT": throw new ForbiddenException(body);
        case "ENTITY_NOT_FOUND": throw new NotFoundException(body);
        case "SOURCE_CHANGED": case "TRANSLATION_CHANGED": throw new ConflictException(body);
        case "VALIDATION_FAILED": throw new UnprocessableEntityException(body);
      }
    }
  }
  private read(kind: EntityKind, principal: Principal, id: string, locale: string) {
    const target = this.target(kind, principal, id, locale);
    return this.run(async () => operations[kind].get.out.parse(await getLocalizationAdmin(target, this.deps)));
  }
  private save(kind: EntityKind, principal: Principal, id: string, locale: string, body: unknown) {
    const target = this.target(kind, principal, id, locale);
    return this.run(async () => operations[kind].put.out.parse(await putLocalization({ ...target, body }, this.deps)));
  }
  private remove(kind: EntityKind, principal: Principal, id: string, locale: string, body: unknown) {
    const target = this.target(kind, principal, id, locale);
    return this.run(async () => operations[kind].clear.out.parse(await clearLocalization({ ...target, body }, this.deps)));
  }
  private sourceLocale(kind: EntityKind, principal: Principal, id: string, body: unknown) {
    const target = this.identityTarget(kind, principal, id);
    return this.run(async () => operations[kind].sourceLocale.out.parse(await setLocalizationSourceLocale({ ...target, body }, this.deps)));
  }
  @Get(operations.skill.get.path)
  getSkill(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Param("locale") locale: string) { return this.read("skill", p, id, locale); }
  @Get(operations.agent.get.path)
  getAgent(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Param("locale") locale: string) { return this.read("agent", p, id, locale); }
  @Put(operations.skill.put.path)
  putSkill(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Param("locale") locale: string, @Body() body: unknown) { return this.save("skill", p, id, locale, body); }
  @Put(operations.agent.put.path)
  putAgent(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Param("locale") locale: string, @Body() body: unknown) { return this.save("agent", p, id, locale, body); }
  @Delete(operations.skill.clear.path)
  clearSkill(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Param("locale") locale: string, @Body() body: unknown) { return this.remove("skill", p, id, locale, body); }
  @Delete(operations.agent.clear.path)
  clearAgent(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Param("locale") locale: string, @Body() body: unknown) { return this.remove("agent", p, id, locale, body); }
  @Put(operations.skill.sourceLocale.path)
  setSkillSourceLocale(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Body() body: unknown) { return this.sourceLocale("skill", p, id, body); }
  @Put(operations.agent.sourceLocale.path)
  setAgentSourceLocale(@CurrentPrincipal() p: Principal, @Param("entityId") id: string, @Body() body: unknown) { return this.sourceLocale("agent", p, id, body); }
}
