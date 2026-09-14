/**
 * issue #3389 —— **一轮 assistant 正文只有一份事实：账本里的 `text_delta` 字节。**
 *
 * 本文件保留应用层的既有导出；唯一实现位于共享 AG-UI 契约中，模型写回、relay 与 web
 * 权威恢复共同消费它。拼法不许在调用点各写一遍。
 *
 * #3397 扩展 `chat_message_id.streamingMessageIds` 后，relay 与 web 才能安全地让整组
 * 气泡共同认领同一条落库正文；旧客户端仍消费 singular 主气泡。
 *
 * 规则本身逐字沿用 #3243 定下的那条（`joinTurnAssistantBodies` 原实现）：逐段 `trim`、
 * 丢空段、逐字重复的段只留一条、用空行拼接。**不要**在任何调用点另写一遍。
 */
export { composeAguiAssistantBodies as composeAssistantBodies } from "@repo/contracts/agui-state-events";
