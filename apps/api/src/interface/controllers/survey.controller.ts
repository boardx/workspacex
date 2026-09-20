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
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  SurveyDraftInputSchema,
  SurveySaveInputSchema,
  SurveyVersionInputSchema,
  SurveyPublishInputSchema,
  SurveySubmissionInputSchema,
} from "@repo/contracts/survey-runtime";
import {
  SurveyError,
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
    if (e.code === "version_conflict" || e.code === "submission_conflict")
      throw new ConflictException(e.code);
    if (e.code === "closed" || e.code === "expired")
      throw new GoneException(e.code);
    throw new BadRequestException(e.code);
  }
}
@Controller("/surveys")
export class SurveyController {
  private readonly service: SurveyService;
  constructor(@Inject(SURVEY_REPOSITORY) repo: SurveyRepository) {
    this.service = new SurveyService(repo);
  }
  @Get() list(@CurrentPrincipal() p: Principal) {
    assertPrincipal(p);
    return run(() => this.service.list(p.orgId, p.userId));
  }
  @Post() create(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    assertPrincipal(p);
    const input = parse(SurveyDraftInputSchema, body);
    return run(() => this.service.create(p.orgId, p.userId, input));
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
    const input = parse(SurveySaveInputSchema, body);
    return run(() =>
      this.service.save(p.orgId, p.userId, id, input.expectedVersion, input),
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
    const input = parse(
      SurveyVersionInputSchema.extend({
        quality: z.enum(["normal", "review"]),
      }),
      body,
    );
    return run(() =>
      this.service.review(
        p.orgId,
        p.userId,
        id,
        input.expectedVersion,
        responseId,
        input.quality,
      ),
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
