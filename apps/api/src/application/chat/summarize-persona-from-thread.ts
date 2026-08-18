/**
 * `summarizePersonaFromThread` —— 把内置 canvas 模板 `persona` 接到 chat 里：
 * 扫描线程里已经真实写出的画像信息，落地成一份 Artifact（复用 F114 的落地机制，
 * 见 `land-as-artifact.ts` 文件头「机制委托」）。契约面见 `packages/contracts/src/chat.ts`
 * 的 `summarizePersonaFromThread`（`KNOWN_CONTRACT_GAPS.C_CHAT_11`，已由 design-delta
 * chat-persona-roundtrip 补签，confirmed 2026-08-18：恒 draft、信息不足落占位、
 * 产出同时以 assistant 消息（mindmap 围栏）进线程并返回 `resultMessageId`）。
 *
 * ## 这个函数自己只做一件事：把线程正文交给 `landAsArtifact`
 *
 * 「哪些内容算画像信息」「找不到时怎么办」全部委托给纯函数
 * `domain/canvas/persona-summary.ts` 的 `buildPersonaLanding`；「怎么落地成
 * Artifact、判权、算 provenance」全部委托给已有的 `landAsArtifact`。本文件唯一自己
 * 决定的事：从线程里**读哪些消息**（判权路径与 `landAsArtifact` 本身、`getThread`
 * 同一条——先 `findMessageLocation` 定位、再 `resolveVisibility`、再走
 * `findMessages` 这道守卫读路径，见 `get-thread.ts` 文件头）。
 *
 * ⚠ 这里对 `resolveVisibility` 的调用与 `landAsArtifact` 内部自己再做一次的调用
 *   **不是同一次判定的复用**——是两次独立判定，各自对应各自要读的东西（本函数的
 *   一次是为了读消息正文；`landAsArtifact` 内部那次是为了判它自己的写权）。两次
 *   判的是同一个 `(userId, orgId, threadId)`，结果不会分叉；把它们合并成一次会
 *   要求 `landAsArtifact` 多开一个「判定结果已经算好，直接抄」的口子，而那正是
 *   `permission-filter.ts` 的 `Guarded` 想避免的形状（判定与使用必须离得足够近，
 *   近到没有空间在中间夹带一个没判过的值）。
 */
import type { OrgId } from "../../domain/org-id";
import { buildPersonaLanding, buildPersonaMindmapBody } from "../../domain/canvas/persona-summary";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";
import {
  landAsArtifact,
  type LandAsArtifactDeps,
  type LandAsArtifactResult,
} from "./land-as-artifact";

export interface SummarizePersonaFromThreadDeps extends ResolveVisibilityDeps, LandAsArtifactDeps {
  readonly chat: ChatRepository;
}

export interface SummarizePersonaFromThreadInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  /** 触发这次汇总的锚点消息——同 `landAsArtifact` 的 `messageId`，用于出处回链。 */
  readonly messageId: string;
}

/**
 * G2 assistant 消息的 `author_id`（design-delta chat-persona-roundtrip，confirmed
 * 2026-08-18）。这不是某个已发布 Agent 的回复（`agent_id` 恒 NULL），是 persona
 * 汇总端口自己的产出——一个稳定的端口标识，测试与前端识别用同一份。
 */
export const PERSONA_SUMMARY_AUTHOR_ID = "persona-summary";

export type SummarizePersonaFromThreadResult = LandAsArtifactResult & {
  /** false ⇒ 线程正文里没有找到任何可辨认的画像信息；落地内容是「信息不足」占位。 */
  readonly sufficient: boolean;
  /** 画像 mindmap 落成的那条 assistant 消息 id（契约 `out.resultMessageId`）。 */
  readonly resultMessageId: string;
};

export async function summarizePersonaFromThread(
  deps: SummarizePersonaFromThreadDeps,
  input: SummarizePersonaFromThreadInput,
): Promise<SummarizePersonaFromThreadResult> {
  const location = await deps.chat.findMessageLocation(input.orgId, input.messageId);
  if (location === null || location.threadId !== input.threadId) {
    throw new ThreadNotVisibleError();
  }

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: location.projectId,
    threadId: input.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const guarded = await deps.chat.findMessages(input.orgId, input.threadId);
  if (guarded === null) throw new ThreadNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();

  // 按发出时间拼接全部正文——`buildPersonaLanding` 只识别逐字匹配的
  // `字段: 值` / `## 分区名` / `- 要点`，顺序只影响「同一字段被后写的值覆盖」这一件
  // 事（与 persona 模板自己的文本语法本就允许的行为一致）。
  const ordered = [...disclosed.payload].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rawText = ordered.map((m) => m.body).join("\n\n");

  const draft = buildPersonaLanding(rawText);

  const landing = await landAsArtifact(deps, {
    userId: input.userId,
    orgId: input.orgId,
    threadId: input.threadId,
    messageId: input.messageId,
    mode: "draft",
    title: draft.title,
    payloadRef: draft.payloadRef,
  });

  // G2 行为约定（签核 confirmed 2026-08-18）：产出同时以 assistant 消息进入线程，
  // 正文为 mermaid mindmap 围栏（根节点=画像名、六分支=PERSONA_SECTIONS；
  // `sufficient: false` 时六分支各挂「信息不足」占位）。落 artifact 的既有行为
  // 保留（契约用例表逐字：「同时落一份 draft Artifact（现有行为保留）」）。
  const resultMessageId = deps.artifactIds.next("pmsg");
  await deps.chat.insertAssistantMessage(input.orgId, {
    id: resultMessageId,
    threadId: input.threadId,
    authorId: PERSONA_SUMMARY_AUTHOR_ID,
    body: buildPersonaMindmapBody({
      rawText,
      title: draft.title,
      sufficient: draft.sufficient,
    }),
    replyToMessageId: input.messageId,
  });

  return { ...landing, sufficient: draft.sufficient, resultMessageId };
}
