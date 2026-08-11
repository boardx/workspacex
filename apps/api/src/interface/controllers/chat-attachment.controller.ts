/**
 * #946 · V9-a F150 —— 对话附件上传路由（`POST /chat/threads/:threadId/attachments`）。
 *
 * 本仓**第一个**真正的文件上传端点（既有 `land-as-artifact` 走的是 payloadRef，不收字节）。
 * 传输走 multipart（coord-main 裁决 A=multer），字段名 `file`。协议适配层：每一条判断都在
 * `application`（`uploadAttachment` 用例）与 `domain`（字节/白名单/MIME 字节校验），这里只做
 * ①解 multipart ②MIME 字节校验（`MIME_MISMATCH`，服务端权威）③把用例的错误映射成 HTTP。
 *
 * ## 上限单源（coord-main 裁决第 2 条）
 * multer 的 `limits.fileSize` / 文件数**从契约 `ATTACHMENT_LIMITS` 导入**，不在本文件另写
 * 25MB/10——本仓五次「同一事实两处声明」教训。multer 自己的拒绝（`LIMIT_FILE_SIZE`）在
 * `all-exceptions.filter.ts` 映射成契约码 `FILE_TOO_LARGE`（那是 interceptor 阶段抛的，早于
 * 本处理器，catch 不到）。
 *
 * ## 状态码
 *   201  上传成功，落一行 pending 附件（`message_id IS NULL`，挂消息在 F151）。
 *   404  线程不可见或不存在——**裸 404 不带 reasonCode**（I-3，与所有读路径逐字节相同）。
 *   403  观察者无写权（`NO_WRITE_ROLE`，与 createMessage 一致：个人对话 null role 允许）。
 *   413  超单文件字节上限（`FILE_TOO_LARGE`；multer 硬顶 + 用例复核）。
 *   415  MIME 不在白名单（`FILE_TYPE_REJECTED`）。
 *   422  声明 MIME 与实际字节不同族（`MIME_MISMATCH`，改扩展名骗白名单的攻击面）。
 *   409  该线程 pending 附件已达 10（`ATTACHMENT_LIMIT_EXCEEDED`）。
 *   503  对象存储不可用（`STORAGE_UNAVAILABLE`，先存储后落库，存储失败不产生幽灵行）。
 */
import {
  type ArgumentsHost, BadRequestException, Catch, ConflictException, Controller, type ExceptionFilter,
  ForbiddenException, HttpCode, HttpStatus, Inject, NotFoundException, Param, PayloadTooLargeException,
  Post, ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException,
  UploadedFile, UseFilters, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { chatFileUpload as CFU } from "@repo/contracts";
import { traceIdOf } from "../middleware/trace";
import {
  AttachmentUploadError,
  CHAT_ATTACHMENT_COMMAND_REPOSITORY,
  uploadAttachment,
  type AttachmentCommandRepository,
} from "../../application/chat/upload-attachment";
import { ThreadNotVisibleError } from "../../application/chat/get-thread";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  DECISION_ID_FACTORY, IDENTITY_REPOSITORY,
  type DecisionIdFactory, type IdentityRepository,
} from "../../application/identity/ports";
import {
  ID_FACTORY, OBJECT_STORE, type IdFactory, type ObjectStore,
} from "../../application/artifact/ports";
import { CLOCK, type Clock } from "../../application/auth/ports";
import {
  ATTACHMENT_EXTRACTION_STORE, type AttachmentExtractionStore,
} from "../../application/chat/attachment-extraction-store";
import {
  ATTACHMENT_TO_MARKDOWN, type AttachmentToMarkdownPort,
} from "../../application/chat/attachment-to-markdown.port";
import {
  ATTACHMENT_EXTRACTION_EXECUTOR, type AttachmentExtractionExecutorPort,
} from "../../application/chat/attachment-extraction-executor.port";
import { declaredMimeMatchesBytes } from "../../domain/chat/attachment-mime-sniff";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

/** multer 选项：内存存储（不落临时文件，无清理面），单文件，大小上限取自契约。 */
/**
 * multer 超 `fileSize` 限时抛 `LIMIT_FILE_SIZE`，被 `@nestjs/platform-express` 的
 * `transformException` **转成 `PayloadTooLargeException`**（早于全局 filter，且 body 是裸消息串，
 * 不带 reasonCode）。本控制器专属 filter 把「本端点的 413」翻成契约码 `FILE_TOO_LARGE`——
 * 这是安全的局部化：multipart 上传里 413 只可能来自 multer 的文件大小上限，不会撞别的 413 源。
 * 其余异常（含普通 400 / 领域错误）不匹配 `@Catch`，照常落到全局 filter。
 */
@Catch(PayloadTooLargeException)
class AttachmentTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      error: "payload_too_large",
      traceId: traceIdOf(http.getRequest()),
      reasonCode: "FILE_TOO_LARGE",
    });
  }
}

const UPLOAD_MULTER_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    // 唯一事实源——契约 `ATTACHMENT_LIMITS.maxBytesPerFile`。超此值 multer 抛
    // `LIMIT_FILE_SIZE`，由 all-exceptions.filter 映射成 413 / `FILE_TOO_LARGE`。
    fileSize: CFU.ATTACHMENT_LIMITS.maxBytesPerFile,
    files: 1,
  },
} as const;

@Controller()
export class ChatAttachmentController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(CHAT_ATTACHMENT_COMMAND_REPOSITORY) private readonly attachments: AttachmentCommandRepository,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(ID_FACTORY) private readonly attachmentIds: IdFactory,
    @Inject(CLOCK) private readonly clock: Clock,
    // F153（V9-b）：内容抽取子系统——上传成功后触发（≤3MB 内联，更大异步）。
    @Inject(ATTACHMENT_EXTRACTION_STORE) private readonly extraction: AttachmentExtractionStore,
    @Inject(ATTACHMENT_TO_MARKDOWN) private readonly converter: AttachmentToMarkdownPort,
    @Inject(ATTACHMENT_EXTRACTION_EXECUTOR) private readonly executor: AttachmentExtractionExecutorPort,
  ) {}

  private get deps() {
    return {
      repo: this.repo, ids: this.ids, chat: this.chat, attachments: this.attachments,
      store: this.store, attachmentIds: this.attachmentIds,
      // 平台 Clock.now() 回 Date；用例的 createdAt 要 ISO 串（落 timestamptz）——这里适配。
      clock: { now: () => this.clock.now().toISOString() },
      // F153：接上抽取子系统。
      extraction: this.extraction, converter: this.converter, executor: this.executor,
    };
  }

  @HttpCode(HttpStatus.CREATED)
  @Post("/chat/threads/:threadId/attachments")
  @UseFilters(AttachmentTooLargeFilter)
  @UseInterceptors(FileInterceptor("file", UPLOAD_MULTER_OPTIONS))
  async upload(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    assertPrincipal(principal);
    if (file === undefined) throw new BadRequestException("file_required");

    // MIME 字节校验（服务端权威，coord-main 第 4 条）：仅当声明的 mime 本就在白名单内才做——
    // 白名单外的类型交给用例判 FILE_TYPE_REJECTED（415），这里不越俎代庖判成 MIME_MISMATCH。
    const declaredMime = file.mimetype;
    const whitelisted = (CFU.ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(declaredMime);
    if (whitelisted && !declaredMimeMatchesBytes(declaredMime, file.buffer)) {
      throw new UnprocessableEntityException({ reasonCode: "MIME_MISMATCH" });
    }

    try {
      return await uploadAttachment(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        threadId,
        filename: file.originalname,
        mime: declaredMime,
        bytes: file.buffer, // Buffer 是 Uint8Array 子类，byteLength 即权威大小
      });
    } catch (e) {
      // 裸 404，不带 reasonCode——与所有读路径逐字节相同（I-3）。
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      if (e instanceof AttachmentUploadError) {
        switch (e.code) {
          case "NO_WRITE_ROLE":
            throw new ForbiddenException({ reasonCode: "NO_WRITE_ROLE" });
          case "FILE_TOO_LARGE":
            throw new PayloadTooLargeException({ reasonCode: "FILE_TOO_LARGE" });
          case "FILE_TYPE_REJECTED":
            throw new UnsupportedMediaTypeException({ reasonCode: "FILE_TYPE_REJECTED" });
          case "ATTACHMENT_LIMIT_EXCEEDED":
            throw new ConflictException({ reasonCode: "ATTACHMENT_LIMIT_EXCEEDED" });
          case "STORAGE_UNAVAILABLE":
            throw new ServiceUnavailableException({ reasonCode: "STORAGE_UNAVAILABLE" });
        }
      }
      throw e;
    }
  }
}
