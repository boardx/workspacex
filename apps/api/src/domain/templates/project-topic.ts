/**
 * 项目定题 —— 单点继承（F24 / `uc-2-2` R7 I-13 / 契约 `templates.saveAndSyncTopic`）。
 *
 * ## 「整场只有一个主题、一段背景」在这里落成什么形状
 *
 * 不是「三份拷贝 + 一致性校验」，是**从一开始就只有一行**：`ProjectTopic` 以 `projectId`
 * 为唯一键（仓储侧是唯一约束，不是应用层的「先查后写」），分组/议程/AI 上下文三处**读同一个
 * `topicId`**，而不是各自持有一份主题文本再靠同步保持一致。「不存在第二份主题/背景记录」
 * （V5）因此是一个存储层不变量，本文件负责的是「保存时产生的是同一行的新版本，不是新的一行」
 * 这条语义——`saveAndSync` 的仓储实现必须是 upsert-by-projectId，不能是 insert。
 *
 * ## AI 生成必须挂来源，为什么这里还要再判一次空数组
 *
 * 契约 `saveAndSyncTopic.in.aiGenerated.sources` 已经是 `z.array(z.string()).min(1)`——
 * 走 HTTP 这条路径时 zod 会先拦住空数组。但用例函数本身也可能被直接调用（测试、未来的
 * 内部调用方），`.min(1)` 的保证只在「值是从 zod `.parse()` 出来的」这个前提下成立。
 * `isAiSourcesSufficient` 把这条校验搬进 domain，讲的是同一件事：**没有来源就不能算 AI 产出**，
 * 与「走没走 HTTP」无关。
 */

export interface AiGeneratedProvenance {
  readonly sources: readonly string[];
}

export interface ProjectTopic {
  readonly topicId: string;
  readonly projectId: string;
  readonly title: string;
  readonly background: string;
  readonly revision: string;
  /** null = 人工填写；非 null = 本次内容来自 AI，且必须挂来源（R7/V8）。 */
  readonly aiGenerated: AiGeneratedProvenance | null;
}

/** 三处读的是**同一个 `topicId`**——这里列出的是「同步到了哪些视图」，不是三份副本（V5）。 */
export const TOPIC_SYNCED_VIEWS = ["grouping", "agenda", "ai-context"] as const;
export type TopicSyncedView = (typeof TOPIC_SYNCED_VIEWS)[number];

/** 未经人确认的 AI 产出不算数：来源列表非空才算「够格」（R7/V8）。 */
export function isAiSourcesSufficient(aiGenerated: AiGeneratedProvenance | null): boolean {
  if (aiGenerated === null) return true;
  return aiGenerated.sources.length > 0;
}
