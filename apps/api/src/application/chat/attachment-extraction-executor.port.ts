/**
 * #946 · F153/W1（V9-b）—— 抽取执行器端口：触发某租户的抽取排空。
 *
 * 为什么是 kick 而不是定时全表扫：`chat_attachment_extraction_outbox` RLS FORCEd，跨租户扫
 * 恒读 0 行、永远像空队列（同 agent-run/ingestion 的成例）。租户由**入队方**（上传用例）指名，
 * kick 从这个已知租户排空。进程重启遗留的 job 由同租户下一次上传的 kick 顺带认领，无需独立 reaper。
 */
import type { OrgId } from "../../domain/org-id";

export interface AttachmentExtractionExecutorPort {
  /** 触发该租户的抽取排空。**fire-and-forget**：不阻塞、不拖慢上传/挂消息。 */
  kick(orgId: OrgId): void;
}

export const ATTACHMENT_EXTRACTION_EXECUTOR = Symbol("AttachmentExtractionExecutorPort");
