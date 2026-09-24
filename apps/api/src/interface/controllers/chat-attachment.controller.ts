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
 *
 * ## #1584 —— 字节读路径（`GET .../attachments/:attachmentId/content`）**不是契约操作**
 *
 * 与 `org-admin-management.controller.ts` 的 `avatarFile` 同一处置：真正的门是
 * `@CurrentPrincipal` 这个 Guard 本身（裸 `<img src>`/`<a href>` 发不出 `Authorization`
 * 头，直接指到这条路由只会拿到 401），不需要再进 `packages/contracts` 走一次 ADR-023
 * 的契约签核——那套签核是给"新的、需要评审的产品语义"设的，这里只是把已经上传成功、
 * 已经有判权先例（`resolve-visibility.ts` 头注点名"文件下载"是必须过 `resolveVisibility`
 * 的既有读路径之一）的字节吐回来，没有新增设计面。前端侧配套 `useAuthedImageSrc`
 * （`apps/web/lib/use-authed-image-src.ts`，尽管名字带"Image"，实现本就是任意字节通用的，
 * 聊天附件预览弹窗直接复用，不另写第二份）。
 */
import {
  type ArgumentsHost, BadRequestException, Catch, ConflictException, Controller, type ExceptionFilter,
  ForbiddenException, Get, Header, HttpCode, HttpStatus, Inject, NotFoundException, Optional, Param,
  PayloadTooLargeException, Post, Query, Res, ServiceUnavailableException, UnprocessableEntityException,
  UnsupportedMediaTypeException, UploadedFile, UseFilters, UseInterceptors,
} from "@nestjs/common";
import { FIRST_VALUE_RECORDER, recordFirstValue, type FirstValueRecorder } from "../../application/first-value/first-value-recorder";
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
import { listThreadAttachments } from "../../application/chat/list-thread-attachments";
import { ThreadNotVisibleError } from "../../application/chat/get-thread";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { getAttachmentContent, ObjectMissingError } from "../../application/chat/get-attachment-content";
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
  ATTACHMENT_VISION, type AttachmentVisionPort,
} from "../../application/chat/attachment-vision.port";
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

/**
 * multipart 的 `Content-Disposition` filename 复原成 UTF-8。
 *
 * multer 2.x 底层 busboy 的 `defParamCharset` 默认是 **latin1**，且本控制器的
 * `UPLOAD_MULTER_OPTIONS` 没覆盖它——于是浏览器按 RFC 发的 UTF-8 文件名被 latin1 解成一串
 * mojibake：中文「截屏 2026-08-09.png」变成「æ ªå± 2026-08-09.png」，「风险核算模板.docx」
 * 变成「é£ é ©æ ¸å ...docx」（2026-08-12 人类 devapp 实测）。这里把那串 latin1 字节按 UTF-8
 * 重新解码复原。纯 ASCII 文件名在 latin1↔utf8 下同形，本转换对它是无副作用的 no-op。
 */
export function decodeMultipartFilename(name: string): string {
  // 只有当 name 整串落在 latin1 可打印区间（busboy 默认 latin1 解码的产物）时才复原。若已含 > 0xFF 的
  // 字符——说明它本就是正确 UTF-8（例如 RFC2231 `filename*=UTF-8''…` 被 busboy 按 charset 正确
  // 解过）——原样返回，绝不二次解码（对 > 0xFF 的字符做 latin1 编码会截断成低字节、反而毁掉它）。
  // 下界是空格 U+0020：C0 控制字符不是合法文件名字符，也不会出现在 latin1 误解的 UTF-8 字节串里
  // （UTF-8 多字节序列全部 ≥ 0x80），带控制字符的名字同样原样返回，而不是拿去做一次必然乱码的重解。
  //
  // ⚙ #1718：字符类必须写成显式 `\u` 转义。这行曾直接写裸字符，而那个「空格」其实是一个
  // 裸 NUL（U+0000）——肃然无声：git 从此把本文件当二进制（`git diff` 只显示 `Bin … bytes`，diff/blame/
  // grep 全失效）。转义形式让边界在 code review 里看得见；由 attachment-filename-decode.test.ts 机械盯住。
  if (/[^\u0020-\u00ff]/.test(name)) return name;
  return Buffer.from(name, "latin1").toString("utf8");
}

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
    // #1560 P1：图片走 VLM 视觉理解（转录+描述），与文档转换同一条落库路径。
    @Inject(ATTACHMENT_VISION) private readonly vision: AttachmentVisionPort,
    @Inject(ATTACHMENT_EXTRACTION_EXECUTOR) private readonly executor: AttachmentExtractionExecutorPort,
    // E3：第一个价值时刻埋点（fire-and-forget）。可选注入：手工构造的控制器没有它时即 no-op。
    @Optional() @Inject(FIRST_VALUE_RECORDER) private readonly firstValue?: FirstValueRecorder,
  ) {}

  private get deps() {
    return {
      repo: this.repo, ids: this.ids, chat: this.chat, attachments: this.attachments,
      store: this.store, attachmentIds: this.attachmentIds,
      // 平台 Clock.now() 回 Date；用例的 createdAt 要 ISO 串（落 timestamptz）——这里适配。
      clock: { now: () => this.clock.now().toISOString() },
      // F153：接上抽取子系统。
      extraction: this.extraction, converter: this.converter, vision: this.vision,
      executor: this.executor,
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
      const uploaded = await uploadAttachment(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        threadId,
        filename: decodeMultipartFilename(file.originalname),
        mime: declaredMime,
        bytes: file.buffer, // Buffer 是 Uint8Array 子类，byteLength 即权威大小
      });
      recordFirstValue(this.firstValue, principal.orgId, "own_material_uploaded");
      return uploaded;
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

  /**
   * `listThreadAttachments`（#728 D9，右侧栏「材料」）。契约操作，见
   * `packages/contracts/src/chat-file-upload.ts` 与 `list-thread-attachments.ts` 头注。
   * 裸 404 不带 reasonCode——与 `listThreadArtifacts` 逐字节相同（I-3）。
   *
   * `projectId` query 参数缺失（个人线程，issue #1824）时归一成 `null`，不是
   * `undefined`——同 `threadArtifacts`/`threadArtifactSource` 两条既有路由的理由：
   * `resolveVisibility` 靠 `projectId === null` 与 `undefined` 走不同分支。
   */
  @Get("/chat/threads/:threadId/attachments")
  async listAttachments(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    try {
      return await listThreadAttachments(this.deps, {
        userId: principal.userId, orgId: toOrgId(principal.orgId), projectId: projectId ?? null, threadId,
      });
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * #1584 —— 字节读路径（预览/下载共用）。不是契约操作，见本文件头注。
   *
   * `?download=1` 时 `Content-Disposition: attachment`（触发浏览器另存），否则
   * `inline`（预览弹窗 `<img>`/`<iframe>` 用）——同一条路由，不是两条重复实现。
   * 文件名走 RFC 5987 `filename*=UTF-8''...`，中文/非 ASCII 文件名不再依赖
   * `Content-Disposition` 的裸 `filename=` 那套（各浏览器对非 ASCII 裸 filename 的
   * 处理不一致，`filename*` 是标准解法，`decodeMultipartFilename` 已把落库的 filename
   * 复原成正确 UTF-8，这里只需要按 5987 编码一次）。
   */
  @Get("/chat/threads/:threadId/attachments/:attachmentId/content")
  @Header("Cache-Control", "private, max-age=300")
  async content(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
    @Query("download") download: string | undefined,
  ): Promise<void> {
    assertPrincipal(principal);
    try {
      const result = await getAttachmentContent(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        threadId,
        attachmentId,
      });
      // Generated HTML is downloadable data, never an app-origin executable preview.
      const isHtml = result.mime.split(";",1)[0]?.trim().toLowerCase() === "text/html";
      const disposition = download === "1" || isHtml ? "attachment" : "inline";
      const encodedName = encodeURIComponent(result.filename);
      res.setHeader("Content-Type", result.mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodedName}`);
      res.send(Buffer.from(result.bytes));
    } catch (e) {
      // 裸 404，不带 reasonCode——与上传路径、其余读路径逐字节相同（I-3）：线程不可见、
      // 线程存在但没有这个附件 id，两种情况对外同一响应。
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      if (e instanceof ObjectMissingError) throw new ServiceUnavailableException("storage_unavailable");
      throw e;
    }
  }
}
