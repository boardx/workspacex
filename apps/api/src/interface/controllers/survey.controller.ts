import { SurveyTemplateInputSchema, SurveyTemplateSaveInputSchema, SurveyTemplateKindSchema } from "@repo/contracts/survey-template-library";
import { SurveyTemplateService, SURVEY_TEMPLATE_REPOSITORY, type SurveyTemplateRepository } from "../../application/survey/survey-template-service";
import { SurveySubmissionRateLimitGuard } from "../guards/survey-submission-rate-limit.guard";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  GoneException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  SurveyDraftInputSchema,
  SurveyCreateCommandSchema,
  SurveySaveCommandSchema,
  SurveyVersionInputSchema,
  SurveyPublishInputSchema,
  SurveySubmissionInputSchema,
  SurveyResponseReviewInputSchema,
} from "@repo/contracts/survey-runtime";
import {
  SurveyError,
  SurveyPublishBlockedError,
  SurveyService,
  SURVEY_REPOSITORY,
  type SurveyRepository,
} from "../../application/survey/survey-service";
import { CurrentPrincipal } from "../current-principal.decorator";
import { Public } from "../public.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException("invalid_survey_input");
  return r.data;
}
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (!(e instanceof SurveyError)) throw e;
    if (e.code === "not_found") throw new NotFoundException();
    if (e instanceof SurveyPublishBlockedError)
      throw new UnprocessableEntityException({
        reasonCode: "SURVEY_PUBLISH_BLOCKED",
        blockers: e.blockers,
      });
    if (e.code === "version_conflict")
      throw new ConflictException({ reasonCode: "SURVEY_VERSION_CONFLICT" });
    if (e.code === "anonymity_immutable")
      throw new ConflictException({ reasonCode: "ANONYMITY_IMMUTABLE" });
    if (e.code === "status_command_required")
      throw new ConflictException({ reasonCode: "STATUS_COMMAND_REQUIRED" });
    if (e.code === "invalid_transition")
      throw new ConflictException({ reasonCode: "INVALID_TRANSITION" });
    if (e.code === "submission_conflict")
      throw new ConflictException(e.code);
    if (e.code === "closed" || e.code === "expired")
      throw new GoneException(e.code);
    throw new BadRequestException(e.code);
  }
}
function createCommand(body: unknown) {
  const command = SurveyCreateCommandSchema.safeParse(body);
  if (command.success) return command.data;
  return { draft: parse(SurveyDraftInputSchema, body), anonymity: "anonymous" as const };
}
function saveCommand(body: unknown) {
  const command = SurveySaveCommandSchema.safeParse(body);
  if (command.success) return command.data;
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("invalid_survey_input");
  const raw = body as Record<string, unknown>;
  return parse(SurveySaveCommandSchema, {
    expectedVersion: raw.expectedVersion,
    draft: raw,
    anonymity: raw.anonymity,
    status: raw.status,
  });
}
@Controller("/surveys")
export class SurveyController {
  private readonly service: SurveyService;
  private readonly templates: SurveyTemplateService;
  constructor(@Inject(SURVEY_REPOSITORY) repo: SurveyRepository, @Inject(SURVEY_TEMPLATE_REPOSITORY) templateRepo: SurveyTemplateRepository) {
    this.service = new SurveyService(repo);
    this.templates = new SurveyTemplateService(templateRepo);
  }
  @Get() list(@CurrentPrincipal() p: Principal) {
    assertPrincipal(p);
    return run(() => this.service.list(p.orgId, p.userId));
  }
  @Post() create(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    assertPrincipal(p);
    const input = createCommand(body);
    return run(() => this.service.create(p.orgId, p.userId, input.draft, input.anonymity));
  }
  @Get("/templates") listTemplates(@CurrentPrincipal() p: Principal, @Query("kind") kind: unknown) {
    assertPrincipal(p); const filter = parse(SurveyTemplateKindSchema.optional(), kind);
    return run(() => this.templates.list(p.orgId, p.userId, filter));
  }
  @Post("/templates") createTemplate(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    assertPrincipal(p); const input = parse(SurveyTemplateInputSchema, body);
    return run(() => this.templates.create(p.orgId, p.userId, input));
  }
  @Get("/templates/:templateId") getTemplate(@CurrentPrincipal() p: Principal, @Param("templateId") id: string) {
    assertPrincipal(p); return run(() => this.templates.get(p.orgId, p.userId, id));
  }
  @Put("/templates/:templateId") saveTemplate(@CurrentPrincipal() p: Principal, @Param("templateId") id: string, @Body() body: unknown) {
    assertPrincipal(p); const input = parse(SurveyTemplateSaveInputSchema, body);
    return run(() => this.templates.save(p.orgId, p.userId, id, input.expectedVersion, input));
  }
  @Delete("/templates/:templateId") deleteTemplate(@CurrentPrincipal() p: Principal, @Param("templateId") id: string, @Query("expectedVersion") version: unknown) {
    assertPrincipal(p); const expectedVersion = parse(z.coerce.number().int().positive(), version);
    return run(async () => { await this.templates.delete(p.orgId, p.userId, id, expectedVersion); return { deleted: true }; });
  }
  @Get("/:id") get(@CurrentPrincipal() p: Principal, @Param("id") id: string) {
    assertPrincipal(p);
    return run(() => this.service.get(p.orgId, p.userId, id));
  }
  @Put("/:id") save(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = saveCommand(body);
    return run(() =>
      this.service.save(p.orgId, p.userId, id, input.expectedVersion, input.draft, {
        anonymity: input.anonymity,
        status: input.status,
      }),
    );
  }
  @Delete("/:id") delete(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Query("expectedVersion") version: unknown,
  ) {
    assertPrincipal(p);
    const expectedVersion = parse(z.coerce.number().int().positive(), version);
    return run(async () => {
      await this.service.delete(p.orgId, p.userId, id, expectedVersion);
      return { deleted: true };
    });
  }
  @Post("/:id/publish") publish(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = parse(SurveyPublishInputSchema, body);
    return run(() =>
      this.service.publish(
        p.orgId,
        p.userId,
        id,
        input.expectedVersion,
        input.expiresAt,
      ),
    );
  }
  @Post("/:id/prepare") prepare(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = parse(SurveyVersionInputSchema, body);
    return run(() =>
      this.service.prepare(p.orgId, p.userId, id, input.expectedVersion),
    );
  }
  @Post("/:id/withdraw") withdraw(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = parse(SurveyVersionInputSchema, body);
    return run(() =>
      this.service.withdraw(p.orgId, p.userId, id, input.expectedVersion),
    );
  }
  @Post("/:id/start-collection") startCollection(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = parse(SurveyPublishInputSchema, body);
    return run(() =>
      this.service.startCollection(
        p.orgId,
        p.userId,
        id,
        input.expectedVersion,
        input.expiresAt,
      ),
    );
  }
  @Post("/:id/close") close(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = parse(SurveyVersionInputSchema, body);
    return run(() =>
      this.service.close(p.orgId, p.userId, id, input.expectedVersion),
    );
  }
  @Patch("/:id/responses/:responseId") review(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Param("responseId") responseId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = parse(SurveyResponseReviewInputSchema, body);
    return run(() =>
      input.analysis === "excluded"
        ? this.service.excludeFromAnalysis(p.orgId, p.userId, id, input.expectedVersion, responseId, input.exclusionReason!)
        : input.analysis === "included"
          ? this.service.includeInAnalysis(p.orgId, p.userId, id, input.expectedVersion, responseId)
          : this.service.review(p.orgId, p.userId, id, input.expectedVersion, responseId, input.quality!),
    );
  }
  @Post("/:id/report") report(
    @CurrentPrincipal() p: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(p);
    const input = parse(SurveyVersionInputSchema, body);
    return run(() =>
      this.service.report(p.orgId, p.userId, id, input.expectedVersion),
    );
  }
}
@Controller("/public/surveys")
export class PublicSurveyController {
  private readonly service: SurveyService;
  constructor(@Inject(SURVEY_REPOSITORY) repo: SurveyRepository) {
    this.service = new SurveyService(repo);
  }
  @Public() @Get("/:token") get(@Param("token") token: string) {
    return run(() => this.service.publicGet(token));
  }
  @Public()
  @UseGuards(SurveySubmissionRateLimitGuard)
  @Post("/:token/responses")
  submit(@Param("token") token: string, @Body() body: unknown) {
    const input = parse(SurveySubmissionInputSchema, body);
    return run(() => this.service.submit(token, input));
  }
}
