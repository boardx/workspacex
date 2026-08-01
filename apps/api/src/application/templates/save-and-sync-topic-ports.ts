/**
 * F24 的仓储端口 —— `saveAndSyncTopic` 单点继承边界（由 `application` 定义，`infrastructure` 实现）。
 *
 * ## 为什么是 `saveAndSync` 一个方法，不是「写主题」+「同步三个视图」两步
 *
 * 同 `apply-blueprint-ports.ts` 头注的先例：若端口拆成「写一行主题」再「通知分组/议程/AI
 * 上下文各自缓存一份」，「不存在第二份主题/背景记录」（V5）就变成调用方的自觉——中间态
 * （主题已写、某个视图还没通知到）在那种端口形状下表达得出来。这里只有一张表、一次 upsert，
 * 「同步」不是搬运数据到别处，是「别处读的时候查的是同一行」，所以没有第二步可拆。
 *
 * ## 并发冲突为什么是仓储抛错，不是用例先查一次 revision 再比较
 *
 * 同 `idempotencyKey` 去重的理由：「先读 revision，比较，再写」在并发下两个请求都可能读到
 * 同一个旧 revision，然后都写成功——各自以为自己赢了。真正安全的做法是 upsert 语句本身带
 * `WHERE revision = expectedTopicRevision`，仓储发现「更新了 0 行」时抛 `TopicRevisionConflictError`，
 * 应用层只负责把它翻译成契约码 `VERSION_CHANGED`。
 */
import type { AiGeneratedProvenance } from "../../domain/templates/project-topic";

export interface SaveAndSyncTopicCommand {
  readonly projectId: string;
  readonly title: string;
  readonly background: string;
  readonly expectedTopicRevision: string;
  readonly aiGenerated: AiGeneratedProvenance | null;
}

export interface SavedTopic {
  readonly topicId: string;
  readonly revision: string;
}

/** `expectedTopicRevision` 与仓储持有的当前 revision 不一致——同一份主题被并发改过（V-并发态）。 */
export class TopicRevisionConflictError extends Error {
  constructor() {
    super("project topic revision changed concurrently");
    this.name = "TopicRevisionConflictError";
  }
}

export interface ProjectTopicRepository {
  /**
   * upsert-by-`projectId`：第一次调用建行,此后每次调用都更新**同一行**并推进 `revision`——
   * 不存在「已经有一行,又插入第二行」这种路径（V5）。
   */
  saveAndSync(cmd: SaveAndSyncTopicCommand): Promise<SavedTopic>;
}
