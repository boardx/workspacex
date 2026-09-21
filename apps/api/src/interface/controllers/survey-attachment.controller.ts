import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { Public } from "../public.decorator";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { SurveyAttachmentRateLimitGuard } from "../guards/survey-attachment-rate-limit.guard";
import { SurveySubmissionRateLimitGuard } from "../guards/survey-submission-rate-limit.guard";
import {
  SURVEY_ATTACHMENT_SERVICE,
  SURVEY_UPLOAD_MAX_BYTES,
  SurveyAttachmentError,
  SurveyAttachmentService,
} from "../../application/survey/survey-attachment-service";
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (!(e instanceof SurveyAttachmentError)) throw e;
    if (e.code === "not_found") throw new NotFoundException();
    if (e.code === "closed") throw new GoneException();
    if (e.code === "limit_exceeded") throw new PayloadTooLargeException();
    throw new BadRequestException(e.code);
  }
}
const path =
  "/public/surveys/:token/upload-sessions/:sessionToken/questions/:questionId/attachments";
function send(
  res: Response,
  row: { bytes: Uint8Array; mime: string; name: string },
) {
  res.setHeader("Content-Type", row.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
  );
  res.send(Buffer.from(row.bytes));
}
@Injectable()
export class SurveyUploadCapabilityGuard implements CanActivate {
  constructor(
    @Inject(SURVEY_ATTACHMENT_SERVICE)
    private readonly service: SurveyAttachmentService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{
      params: { token: string; sessionToken: string; questionId: string };
    }>();
    await run(() =>
      this.service.authorize(
        req.params.token,
        req.params.sessionToken,
        req.params.questionId,
      ),
    );
    return true;
  }
}
@Controller()
export class SurveyAttachmentController {
  constructor(
    @Inject(SURVEY_ATTACHMENT_SERVICE)
    private readonly service: SurveyAttachmentService,
  ) {}
  @Public()
  @UseGuards(SurveySubmissionRateLimitGuard)
  @Post("/public/surveys/:token/upload-sessions")
  create(@Param("token") token: string, @Body() body: unknown) {
    if (
      !body ||
      typeof body !== "object" ||
      !("submissionId" in body) ||
      typeof body.submissionId !== "string"
    )
      throw new BadRequestException();
    return run(() =>
      this.service.createSession(token, body.submissionId as string),
    );
  }
  @Public()
  @UseGuards(SurveyUploadCapabilityGuard, SurveyAttachmentRateLimitGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        fileSize: SURVEY_UPLOAD_MAX_BYTES,
        files: 1,
        fields: 0,
        parts: 2,
      },
    }),
  )
  @Post(path)
  upload(
    @Param("token") token: string,
    @Param("sessionToken") session: string,
    @Param("questionId") q: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file_required");
    return run(() =>
      this.service.upload(token, session, q, {
        name: file.originalname,
        mime: file.mimetype,
        bytes: file.buffer,
      }),
    );
  }
  @Public()
  @UseGuards(SurveyUploadCapabilityGuard, SurveyAttachmentRateLimitGuard)
  @Delete(`${path}/:attachmentId`)
  remove(
    @Param("token") token: string,
    @Param("sessionToken") session: string,
    @Param("questionId") q: string,
    @Param("attachmentId") id: string,
  ) {
    return run(async () => {
      await this.service.remove(token, session, q, id);
      return { deleted: true };
    });
  }
  @Public()
  @UseGuards(SurveyUploadCapabilityGuard, SurveyAttachmentRateLimitGuard)
  @Get(`${path}/:attachmentId`)
  async preview(
    @Param("token") token: string,
    @Param("sessionToken") session: string,
    @Param("questionId") q: string,
    @Param("attachmentId") id: string,
    @Res() res: Response,
  ) {
    send(
      res,
      await run(() => this.service.publicContent(token, session, q, id)),
    );
  }
  @Get("/surveys/:id/responses/:responseId/attachments/:attachmentId/content")
  async content(
    @CurrentPrincipal() p: Principal,
    @Param("id") survey: string,
    @Param("responseId") response: string,
    @Param("attachmentId") id: string,
    @Res() res: Response,
  ) {
    assertPrincipal(p);
    send(
      res,
      await run(() =>
        this.service.ownerContent(p.orgId, survey, p.userId, response, id),
      ),
    );
  }
}
