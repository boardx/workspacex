/**
 * G1 读回（design-delta chat-persona-roundtrip，confirmed 2026-08-18）的取数序列，
 * 从 `ChatDiagramFabric` 抽出成纯逻辑模块：`listThreadArtifacts`（现在带 messageId）
 * 过滤出本消息的保存版，取**最新**一条（签核：多次保存不去重、读回按最新——列表按
 * created_at 升序，最后一条命中即最新），再 `getThreadArtifactSource` 取回 markdown。
 *
 * 返回 null = 没有本人可见的保存版（含他人草稿的 404——I-36：不提示存在性，调用方
 * 退回原始消息文本初始化，与今天完全一致）。任何读回失败也归入 null：读回是增强路径，
 * 失败不应该挡住「打开原始版本」这条本来就存在的路。
 */
import { getThreadArtifactSource, listThreadArtifacts } from "@/lib/live-chat";

export interface SavedDiagramSource {
  readonly markdown: string;
  readonly savedAt: string;
}

export async function fetchLatestSavedDiagramSource(input: {
  threadId: string;
  messageId: string;
  /** `null` = 个人线程（人类裁决，2026-08-21：个人对话也支持 G1 读回）。 */
  projectId: string | null;
  bearer?: string;
  /**
   * One assistant message may contain more than one canvas fence. When supplied,
   * keep walking that message's saves from newest to oldest until the source belongs
   * to this concrete fence. Without it, retain the historical "latest per message"
   * behavior used by a single Mermaid diagram.
   */
  accepts?: (markdown: string) => boolean;
}): Promise<SavedDiagramSource | null> {
  try {
    const list = await listThreadArtifacts(input.threadId, input.projectId, input.bearer);
    // ⚠ 只按 messageId 过滤，**不看 `hasSource`**：那个字段是「有出处引用」（I-33 的
    // citations 判定投影），不是「对象存储里有源字节」——modal 保存的 draft 恒无
    // citations ⇒ hasSource 恒 false，拿它过滤会把每一条保存版都滤掉（e2e 首轮实测
    // 就是这么红的）。字节本体每次落地都有（materializeArtifact 的 content.md）。
    const candidates = list.items.filter((i) => i.messageId === input.messageId);
    const candidatesToRead = input.accepts ? [...candidates].reverse() : candidates.slice(-1);
    let soleCandidateSource: SavedDiagramSource | null = null;
    for (const candidate of candidatesToRead) {
      try {
        const source = await getThreadArtifactSource(
          input.threadId, candidate.artifactId, input.projectId, input.bearer,
        );
        if (candidates.length === 1) {
          soleCandidateSource = { markdown: source.markdown, savedAt: source.savedAt };
        }
        if (!input.accepts || input.accepts(source.markdown)) {
          return { markdown: source.markdown, savedAt: source.savedAt };
        }
      } catch {
        // Another user's draft and a missing artifact intentionally share the same
        // invisible outcome. A different visible save may still match this fence.
      }
    }
    // A single saved artifact keeps the historical behavior even when its source is
    // malformed: the renderer must surface that saved error instead of silently showing
    // the older message body. Identity filtering is only needed when siblings compete.
    return soleCandidateSource;
  } catch {
    return null;
  }
}
