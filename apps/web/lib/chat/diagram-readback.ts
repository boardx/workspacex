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
    for (const candidate of candidatesToRead) {
      try {
        const source = await getThreadArtifactSource(
          input.threadId, candidate.artifactId, input.projectId, input.bearer,
        );
        // issue #3230 —— 这里此前还有一条 `candidates.length === 1` 的旁路：只有一条
        // 保存版时，即便 `accepts` 判否也照样把它返回。它的注释说这是「保留单图的历史
        // 行为」，但**不传 `accepts` 的路径根本走不到那段代码**（下面这个 return 会先
        // 命中），所以那条旁路唯一的实际作用就是**绕过身份判定**。
        //
        // 后果是刷新恢复时的「先出现、随后消失」：一条助手消息里有 N 个画布围栏，而这
        // 条消息名下只要存在**任意一条**已落地产物（最常见是「落地为产物（草稿）」把
        // 整条消息正文落成一条 artifact，或只保存过其中一个围栏），每个围栏挂载即读回
        // 都会拿到同一份不属于自己的 markdown ⇒ `previewCode` 被换掉 ⇒ 外层
        // `key={savedSource.markdown}` 变化 ⇒ 已经画好的 fabric 整棵重挂 ⇒ 新内容过不了
        // `checkCanvasFence` ⇒ 画布先出现、随后变成错误框。
        //
        // 调用方传 `accepts` 就是在声明「这份源必须属于这个围栏」；候选数量是 1 不改变
        // 这句话，判否就返回 null，由调用方退回原始消息文本（本来就存在的诚实降级）。
        if (!input.accepts || input.accepts(source.markdown)) {
          return { markdown: source.markdown, savedAt: source.savedAt };
        }
      } catch {
        // Another user's draft and a missing artifact intentionally share the same
        // invisible outcome. A different visible save may still match this fence.
      }
    }
    return null;
  } catch {
    return null;
  }
}
