/**
 * P2（#1561）—— 推理侧图像通道的**取字节端口 + 纯定界逻辑**。
 *
 * ## 它解决的是 #1558 里被逐层确诊的那条断链
 *
 * #1558 的结论逐字是「上传路径是通的，理解路径是断的」：`image/png` 在
 * `ATTACHMENT_MIME_ALLOWLIST` 里、附件卡片正常显示，但 `ModelCallInput` 全是纯文本，
 * 那张图的像素**没有任何一条路径**能到达模型。P1（#1560）在**摄取时**把图片转成文字
 * 描述走既有文本通路，覆盖不了「左上角那个图标是什么颜色」这类要求模型在回答的当下
 * 真的看到像素的追问。本文件是那条像素通路的取数端。
 *
 * ## 范围**刻意只到本轮触发消息**，不是一条新的跨线程读路径
 *
 * `RunImageScope` 的三个字段就是权限本身（编译进 SQL 的 WHERE，同
 * `pg-file-retrieval.ts` 已经立下的那条纪律：「不是『召回了再过滤』，是查询本身就不出
 * 这些行」）。而且范围比 L3 还窄一档——**只取触发本次 run 的那条消息自己挂的附件**
 * （`message_id = run.inputMessageId` ∧ `thread_id = run.threadId`），不跨消息、不跨线程、
 * 不跨项目。这不是「省事」，是刻意的：run 已经合法持有这条消息的正文与附件元数据
 * （`ClaimedAgentRun.inputText` / `inputAttachments` 就是从它来的），把同一条消息的图像
 * 字节交给模型，可见性判定与既有的那份**完全同一个**，没有新增任何一个可见面。
 * 「上一轮传的图这一轮还能不能看」因此**今天是不能**——那需要跨消息的可见性判定，
 * 具名缺口 `GAP-VISION-CROSS-TURN-IMAGES`，要接就得让判权先以批量谓词形态可复用，
 * 不是在这里抄一份（同 `pg-file-retrieval.ts` 的 `GAP-CE-FTS-SCOPE-GROUP-VISIBILITY`）。
 *
 * ## 上界不是"截断"，是"如实告知的取舍"
 *
 * #1561 硬性纪律：「图像体积/数量要有上界，且超限时如实报错，不静默截断」。这里的实现
 * 形态是 `selectImagesWithinBounds` 返回 `omitted`——每一张没被送进模型的图都带着**具体
 * 原因**回来，调用点（`execute-run.ts`）把它逐条写进模型能读到的文本里。所以模型知道
 * "还有 2 张图我没看到，一张超了 8MB、一张超了张数上限"，用户问起时它说得出来。
 * 被静默丢掉的图正是 #1558 那个 bug 的形态，本文件的存在就是为了不复刻它。
 */
import type { OrgId } from "../../domain/org-id";
import { MODEL_CALL_MAX_IMAGE_BYTES, MODEL_CALL_MAX_IMAGES, isModelCallImageMime } from "./ports";
import type { ModelCallImage } from "./ports";

/**
 * 取图范围锚点。**这三个字段就是权限本身**（编译进 SQL 的 WHERE），不是事后筛子——
 * 同 `FileRetrievalScope` 的既有写法与理由。
 */
export interface RunImageScope {
  readonly threadId: string;
  /** 触发本次 run 的那条人类消息。范围就到这条消息为止，见本文件头注。 */
  readonly messageId: string;
  /** 那条消息的作者 = 本次 run 的请求者（`ClaimedAgentRun.requesterUserId`）。 */
  readonly actorUserId: string;
}

/** 一张候选图的元数据（不含字节）——先看得到体积，才谈得上按体积定界。 */
export interface RunImageRef {
  readonly attachmentId: string;
  readonly filename: string;
  readonly mime: string;
  /** 服务端接收时核验过的权威字节数（`chat_message_attachments.bytes`）。 */
  readonly byteSize: number;
}

export interface RunImagePort {
  /**
   * 列出该 scope 下**图片类**附件的元数据，按创建顺序（用户上传顺序 = 用户心里的
   * 「第一张/第二张」顺序，超限时被丢的必须是靠后那几张，不能是任意几张）。
   *
   * 抛错是允许的（DB 抖动）——调用点降级为「本轮没能取到图」并**如实告知模型**，
   * 绝不 fail run，也绝不假装本来就没有图。
   */
  list(orgId: OrgId, scope: RunImageScope): Promise<readonly RunImageRef[]>;

  /**
   * 读一张图的原始字节。`null` = 对象存储里没有这个 key（元数据在、字节没了）——
   * 与抛错在行为上不同：前者是一个确定的「这张图取不到」，后者是「这次取数没成」。
   * 两者调用点都如实告知模型，但日志分得开。
   */
  read(orgId: OrgId, scope: RunImageScope, attachmentId: string): Promise<Uint8Array | null>;
}

export const RUN_IMAGE_PORT = Symbol("RunImagePort");

/** 一张被排除在本轮模型输入之外的图，以及**具体**原因。原因逐字进模型可读的文本。 */
export interface OmittedRunImage {
  readonly filename: string;
  readonly reason: string;
}

export interface BoundedImageSelection {
  readonly accepted: readonly RunImageRef[];
  readonly omitted: readonly OmittedRunImage[];
}

/**
 * 纯函数：按「单张体积上限」与「张数上限」定界。
 *
 * 顺序语义：先逐张判体积（超限的单独出局，且**不占**张数名额——一张 20MB 的图不该把
 * 后面三张能看的图挤掉），再按剩下的顺序取前 `MODEL_CALL_MAX_IMAGES` 张。
 * 非图片 mime 也在这里出局（`list` 侧已按 mime 过滤，这里是第二道、纯的、可单测的门，
 * 防止将来某个实现放宽了 SQL 谓词就悄悄把 pdf 字节塞给视觉端点）。
 */
export function selectImagesWithinBounds(
  refs: readonly RunImageRef[],
): BoundedImageSelection {
  const accepted: RunImageRef[] = [];
  const omitted: OmittedRunImage[] = [];
  for (const ref of refs) {
    if (!isModelCallImageMime(ref.mime)) {
      omitted.push({ reason: `类型 ${ref.mime} 不是模型可读的图像格式`, filename: ref.filename });
      continue;
    }
    if (ref.byteSize > MODEL_CALL_MAX_IMAGE_BYTES) {
      omitted.push({
        filename: ref.filename,
        reason: `体积 ${ref.byteSize} 字节超过单张上限 ${MODEL_CALL_MAX_IMAGE_BYTES} 字节`,
      });
      continue;
    }
    if (accepted.length >= MODEL_CALL_MAX_IMAGES) {
      omitted.push({
        filename: ref.filename,
        reason: `超过本轮可送入模型的图片张数上限（${MODEL_CALL_MAX_IMAGES} 张）`,
      });
      continue;
    }
    accepted.push(ref);
  }
  return { accepted, omitted };
}

/**
 * 把「本轮图像输入到底发生了什么」渲染成模型能读到的一段中性、诚实的文本。
 *
 * 与 `withAttachmentNotice` 是**两件事**，不能合并：那一条说的是「这条消息挂了哪些附件、
 * 抽取状态如何」（元数据层），这一条说的是「这些图的像素这一轮有没有真的进到你眼前」
 * （推理输入层）。同一轮里两者可能矛盾——附件卡片在、抽取状态 `unsupported`、而像素
 * **确实**送进来了——把它们糊成一句话会让模型无法分辨自己到底看没看到。
 *
 * 全部送进去了 ⇒ 返回 `null`（不加噪声）：模型看得到图这件事本身不需要用文字复述，
 * 它自己看得见。要说的永远是**没看到**的那部分。
 */
export function renderVisionNotice(
  sentCount: number,
  omitted: readonly OmittedRunImage[],
  degradation: VisionDegradation | null,
): string | null {
  if (degradation === null && omitted.length === 0) return null;
  const lines: string[] = [];
  if (degradation !== null) {
    lines.push(`［本轮消息附带 ${degradation.imageCount} 张图片，但${degradation.reason}——`
      + "你看不到这些图的内容。不要凭文件名猜测或假装看过；用户问起图里有什么时，"
      + "如实说明你这一轮没有收到图像内容。］");
  }
  if (omitted.length > 0) {
    const detail = omitted.map((o) => `${o.filename}（${o.reason}）`).join("；");
    lines.push(`［本轮有 ${omitted.length} 张图片未能送入模型：${detail}。`
      + `你${sentCount > 0 ? `只看到了其中 ${sentCount} 张，` : ""}看不到上述这些图的内容，`
      + "被问到它们时要如实说明，不要根据文件名编造。］");
  }
  return lines.join("\n\n");
}

/**
 * 一次「有图但一张都没送进模型」的降级事实。`reason` 逐字进模型可读文本，所以写的是
 * 面向用户的原因，不是异常栈。
 */
export interface VisionDegradation {
  readonly imageCount: number;
  readonly reason: string;
}
