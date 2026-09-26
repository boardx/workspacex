import type { z } from "zod";
import type * as C from "@repo/contracts/chat";

/* 引用（UC-8.2 R7 引用层，三段缺一不可）—— 预览页与实时聊天共用的展示视图（issue #4244）。 */

/** ⚠ 与契约 `chat.CitationAnchorKind` **逐值相同** ⇒ 从契约派生，不留第二份（ADR-020）。 */
export type CitationAnchorKind = z.infer<typeof C.CitationAnchorKind>;
/**
 * 契约里的 `Citation` 是**线上引用**（`{segmentId, artifactVersionId}`）；
 * 这里是**渲染后的展示视图**（带序号、出处全称、已解析的锚点）。两者不同层，故名字上分开。
 */
export interface CitationView {
  /** 持久化引用的 id（`chat_citations.citation_id`）；mock 数据没有。有 id 时点开会上报 E3。 */
  citationId?: string;
  index: number;
  /** 出处全称 */
  sourceFullName: string;
  /** 页码 / 转录时间段 / messageId —— **不能省**，无锚点视为不合格 */
  anchor: string;
  anchorKind: CitationAnchorKind;
}
