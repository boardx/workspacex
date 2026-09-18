/**
 * 本轮图像输入的收集（从 `execute-run.ts` 抽出，issue #3727 / Phase 14 F01 薄网关约束）：
 * 决策全部在这里，`execute-run.ts` 只拿结果拼进 `ModelCallInput`。
 */
import type { OrgId } from "../../domain/org-id";
import { mayMentionAttachments } from "../../domain/chat/attachment-mentions";
import type { VisionInputStatus } from "./context-snapshot";
import type { ExecuteAgentRunDeps } from "./execute-run";
import { isModelCallImageMime } from "./ports";
import type { ClaimedAgentRun, ModelCallImage } from "./ports";
import type { OmittedRunImage, VisionDegradation } from "./run-image-input";
import { renderVisionNotice, selectImagesWithinBounds } from "./run-image-input";

/**
 * P2（#1561）—— 本轮图像输入的全部决策，一处做完：**送不送、送几张、没送的怎么如实交代**。
 *
 * ## 这个函数的存在理由，就是不要复刻 #1558
 *
 * #1558 里用户上传了一张有内容的 PNG、看到了附件卡片、合理预期模型能看到，问了才发现
 * 看不到——「产品允许传图，却在任何地方都没告诉用户『图我看不了』」。所以这里**每一条
 * 不送的路径都必须留下一句模型能读到的话**，没有任何一条分支是"悄悄地什么都不做"。
 *
 * ## 分支与它们对应的快照态（唯一事实源在 `VisionInputStatus` 的文档）
 *
 *   本轮没挂图                        → `none`，不加任何文本（保持既有 run 逐字节不变）。
 *   挂了图但没接 `deps.runImages`      → `not_configured`，也不额外加文本：F153 的附件提示
 *                                       已经如实说过「这个附件读不到内容」。
 *   挂了图但模型没有视觉能力           → `not_supported` + 明确告知（#1561 交付契约第 4 条）。
 *   有能力、但取字节这一步没成         → `degraded` + 明确告知（"这次没取到"，不是"本来没图"）。
 *   送成了至少一张                     → `ok`；被上界挡下的那几张逐条写清原因（不静默截断）。
 */
export async function gatherVisionImages(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
): Promise<{
  readonly images: readonly ModelCallImage[];
  readonly notice: string | null;
  readonly status: VisionInputStatus;
  readonly omittedCount: number;
}> {
  const attachedImageCount = run.inputAttachments.filter((a) => isModelCallImageMime(a.mime)).length;
  const nothing = { images: [] as readonly ModelCallImage[], notice: null } as const;
  const none = { ...nothing, status: "none" as const, omittedCount: 0 };
  // issue #3727：正文里 `@<filename>` 点名的历史图片也在 `runImages.list` 的范围内，
  // 所以"本轮消息没挂图"不再等于"没有图可看"——只有正文连 `@x` 形态都没有时才短路
  // （保持无 @ 的 run 逐字节不变：不调图像端口、不多一个字）。
  const mayMention = mayMentionAttachments(run.inputText);
  if (attachedImageCount === 0 && !mayMention) return none;
  if (!deps.runImages) {
    return attachedImageCount === 0 ? none : { ...nothing, status: "not_configured", omittedCount: attachedImageCount };
  }

  const degraded = (reason: string, status: VisionInputStatus) => ({
    ...nothing,
    status,
    omittedCount: attachedImageCount,
    notice: renderVisionNotice(0, [], { imageCount: attachedImageCount, reason } satisfies VisionDegradation),
  });

  // 能力查询缺席 ⇒ false（fail closed），理由逐字见 `ModelCallPort.supportsVision` 的文档。
  const canSee = deps.model.supportsVision?.(run.modelProvider, run.modelId) ?? false;
  if (!canSee) {
    // 只有 `@` 引用、本轮没挂图时：不去列图（没有视觉能力时不该白白读库），也不报
    // "附带 0 张图"这种假话——历史附件的存在已由 history 里的附件提示告知模型。
    if (attachedImageCount === 0) return none;
    // ⚠ 这条分支就是 #1561 交付契约第 4 条：诚实降级，绝不静默丢弃。图**没有**被送出去，
    // 而模型被明确告知它这轮看不到图——用户问起时它答得出真话，不会假装看过。
    return degraded(
      `本次运行绑定的模型（${run.modelProvider} / ${run.modelId}）不具备视觉输入能力`,
      "not_supported",
    );
  }

  let refs;
  try {
    refs = await deps.runImages.list(orgId, {
      threadId: run.threadId,
      messageId: run.inputMessageId,
      actorUserId: run.requesterUserId,
    });
  } catch (e) {
    deps.log("agent run vision image listing failed, continuing without images", {
      runId: run.runId, detail: e instanceof Error ? e.message : "unexpected vision list failure",
    });
    if (attachedImageCount === 0) return none;
    return degraded("读取这些图片时出错（本轮未能取到图像内容）", "degraded");
  }
  // 本轮实际在范围内的图 = 本轮挂的 + `@` 点名的历史图；后面的差额与降级文案都以它为准。
  const scopedImageCount = Math.max(attachedImageCount, refs.length);
  if (scopedImageCount === 0) return none;

  const { accepted, omitted } = selectImagesWithinBounds(refs);
  const images: ModelCallImage[] = [];
  const allOmitted: OmittedRunImage[] = [...omitted];
  for (const ref of accepted) {
    let bytes: Uint8Array | null;
    try {
      bytes = await deps.runImages.read(orgId, {
        threadId: run.threadId,
        messageId: run.inputMessageId,
        actorUserId: run.requesterUserId,
      }, ref.attachmentId);
    } catch (e) {
      deps.log("agent run vision image read failed", {
        runId: run.runId, detail: e instanceof Error ? e.message : "unexpected vision read failure",
      });
      allOmitted.push({ filename: ref.filename, reason: "读取图像字节时出错" });
      continue;
    }
    if (bytes === null) {
      // 元数据在、字节没了——一个确定的「这张取不到」，与上面的抛错在日志里分得开。
      allOmitted.push({ filename: ref.filename, reason: "图像内容在存储中不存在" });
      continue;
    }
    if (!isModelCallImageMime(ref.mime)) continue; // `selectImagesWithinBounds` 已挡；类型收窄用。
    images.push({ filename: ref.filename, mime: ref.mime, bytes });
  }

  if (images.length === 0) {
    // 有能力、也确实有图，但一张都没送成。这不是 `ok` 的零张——如实记 `degraded`。
    const detail = allOmitted.length > 0
      ? `这些图都未能送入模型（${allOmitted.map((o) => `${o.filename}：${o.reason}`).join("；")}）`
      : "本轮未能取到任何图像内容";
    return {
      ...nothing,
      status: "degraded",
      omittedCount: scopedImageCount,
      notice: renderVisionNotice(0, [], { imageCount: scopedImageCount, reason: detail } satisfies VisionDegradation),
    };
  }
  return {
    images,
    notice: renderVisionNotice(images.length, allOmitted, null),
    status: "ok",
    // 「范围内有几张 vs 模型看到了几张」的差额——审计链上 #1561 要求快照必须能回答的那件事。
    omittedCount: Math.max(0, scopedImageCount - images.length),
  };
}
