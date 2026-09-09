import type { HistoryAttachmentMeta } from "./ports";

/**
 * V9-b 前置 A（#970）—— 把一轮的附件元数据渲染成模型能读到的一行提示，拼到该轮文本末尾。
 *
 * 为什么落进 content 字符串：`ModelCallPort`/各 provider 只认 `{ role, content }`，不读
 * `ThreadHistoryMessage.attachments`。要让模型*知道*有附件，附件必须进 content。
 *
 * 渲染成**中性、诚实**的一行：模型据此可以说「你传了 X（image/png），但我还读不了它的内容」，
 * 而不是矢口否认有附件。附件**内容**进上下文是 B（F153/anydoc），不在这里。
 *
 * 无附件 → 原样返回，不加任何噪声（保持既有 run 的 prompt 逐字节不变，不惊动既有断言）。
 */
export function withAttachmentNotice(
  content: string,
  attachments: readonly HistoryAttachmentMeta[] | undefined,
): string {
  if (!attachments || attachments.length === 0) return content;
  // 逐个附件按抽取状态渲染——一条消息里不同附件状态可能不同（有的抽好了、有的是图片、有的还在抽）。
  const notice = attachments.map(renderAttachmentForModel).join("\n\n");
  return content.length > 0 ? `${content}\n\n${notice}` : notice;
}

/**
 * V9-b（F153）—— 按抽取状态把单个附件渲染成模型能读到的一段：
 *   - extracted   → 折进**抽取内容摘录**（模型真能读文件了）。
 *   - unsupported → 明说抽不出文本（图片无文字层）。
 *   - failed      → 明说提取失败。
 *   - pending/缺省 → 明说内容正在提取、暂不可读（A 阶段的诚实兜底，也覆盖旧数据）。
 */
function renderAttachmentForModel(a: HistoryAttachmentMeta): string {
  const head = `${a.filename}（${a.mime}）`;
  switch (a.extractionStatus) {
    case "extracted":
      return a.extractedExcerpt && a.extractedExcerpt.length > 0
        ? `［附件 ${head} 的内容如下：\n${a.extractedExcerpt}\n］`
        : `［附件 ${head}：已解析，但未提取到文本内容。］`;
    case "unsupported":
      return `［附件 ${head}：无法提取文本内容（例如图片没有文字层）。你知道用户上传了它，但读不到里面的文字。］`;
    case "failed":
      return `［附件 ${head}：内容提取失败，无法读取其内容。］`;
    default:
      return `［附件 ${head}：内容正在提取中，暂时还读不到——你只知道用户上传了这个文件。］`;
  }
}

