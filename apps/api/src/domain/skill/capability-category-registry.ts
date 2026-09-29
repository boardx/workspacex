/**
 * capability-category-registry.ts —— 能力分类登记表（ADR-120 #1；Phase 20 WS02，E6）。
 *
 * ADR-120 的 MCP 工具 `capabilityCategory` 打标尚未落地（第 5 轮），按
 * `phases/phase-20-work-stack-foundation/requirements/01-skill-catalog.md` §依赖 的约定，
 * 本域先建**最小分类登记常量表**：这里是「某分类是否已登记」的唯一判据，
 * 导入（WS02）与就绪性（WS04）都只读这一份。取值来自 `requirements/work-stack-v2/`
 * 实体文档中 Skill 依赖实际使用的分类；新增分类在此登记，不在调用方另列。
 */
const REGISTERED = [
  "analytics.read",
  "artifact.read",
  "artifact.write",
  "calendar.read",
  "calendar.write",
  "crm.read",
  "crm.write",
  "data.read",
  "email.read",
  "knowledge.graph",
  "knowledge.read",
  "knowledge.search",
  "knowledge.write",
  "mail.search",
  "mail.send",
  "notify.inapp",
  "project.read",
  "project.write",
  "sandbox.exec",
  "ticket.read",
  "ticket.write",
  "transcript.read",
  "warehouse.read",
  "web.fetch",
  "web.search",
] as const;

const REGISTERED_SET: ReadonlySet<string> = new Set(REGISTERED);

export function isRegisteredCapabilityCategory(category: string): boolean {
  return REGISTERED_SET.has(category);
}
