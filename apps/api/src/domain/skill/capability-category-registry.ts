/**
 * capability-category-registry.ts —— 能力分类登记表（ADR-120 #1；Phase 20 WS02，E6）。
 *
 * ADR-120 的 MCP 工具 `capabilityCategory` 打标尚未落地（第 5 轮），按
 * `phases/phase-20-work-stack-foundation/requirements/01-skill-catalog.md` §依赖 的约定，
 * 本域先建**最小分类登记常量表**：这里是「某分类是否已登记」的唯一判据，
 * 导入（WS02）与就绪性（WS04）都只读这一份。取值来自 `requirements/work-stack-v2/`
 * 实体文档中 Skill 依赖实际使用的分类；新增分类在此登记，不在调用方另列。
 * （Phase 20 CT04 补登：产品线 27 个 PASS 实体文档 §依赖 实际使用的分类，如 S155/S007/S070/S062。）
 * （CT07 补登：销售线 18 个 PASS 实体文档 §依赖 实际使用的分类——S021/S024/S026/S030/S032/S033/S034/
 *   S035/S036。CT07 落地时漏登，`work-sales` 整包导入因此 422 WORK_SKILL_CAPABILITY_UNREGISTERED。）
 * （批次 2 补登：D001/D006/D007 的 7 个 Workflow 与其 Skill 依赖实际使用的分类——board.write、tracker.write、
 *   kb.publish、docs.publish、project.member.write、knowledge.graph.write 等写类，以及 incident/monitoring/
 *   deploy/directory/workforce.schedule/hr.headcount/finance/org.policy/repo 等只读类；均为 proposed-unwired。
 *   写类同时进 `PLANNED_WORKFLOW_SIDE_EFFECT_CATEGORIES`，管理员才能在授权页看到并授予。）
 * （EV03 门脚本 `gate-policy.ts` 曾另抄一份更短的登记表，G3 与导入/就绪性判据因此漂移；现在它
 *   直接 re-export 本表，`knowledge.graph.read` 等原先只在那一份里的分类并入这里。）
 */
const REGISTERED = [
  "analytics.read",
  "approval.read",
  "artifact.read",
  "artifact.write",
  "audio.transcribe",
  "board.read",
  "board.write",
  "calendar.read",
  "calendar.write",
  "chat.search",
  "citation.record",
  "crm.read",
  "crm.write",
  "data.read",
  "deploy.read",
  "design.read",
  "directory.read",
  "docs.publish",
  "docs.read",
  "document.parse",
  "email.read",
  "enrichment.company.read",
  "file.read",
  "finance.ledger.read",
  "finance.read",
  "hr.headcount.read",
  "incident.read",
  "interview.read",
  "kb.publish",
  "knowledge.graph",
  "knowledge.graph.read",
  "knowledge.graph.write",
  "knowledge.read",
  "knowledge.search",
  "knowledge.write",
  "mail.read",
  "mail.search",
  "mail.send",
  "metric.read",
  "metrics.read",
  "monitoring.read",
  "notify.inapp",
  "org.config.read",
  "org.policy.read",
  "org.suppression.read",
  "pricebook.read",
  "principal.visibility.check",
  "product.usage.read",
  "project.member.write",
  "project.read",
  "project.write",
  "recording.read",
  "registry.cn.read",
  "repo.read",
  "sandbox.exec",
  "skill-artifact.read",
  "sprint.history.read",
  "survey.read",
  "team.roster.read",
  "ticket.read",
  "ticket.write",
  "tracker.read",
  "tracker.write",
  "transcript.read",
  "warehouse.read",
  "web.fetch",
  "web.read",
  "web.search",
  "workflow.receipt.read",
  "workforce.schedule.read",
] as const;

/** 登记表本体（只读集合）；EV03 门脚本 G3 经 `gate-policy.ts` re-export 同一对象。 */
export const REGISTERED_CAPABILITY_CATEGORY_SET: ReadonlySet<string> = new Set(REGISTERED);
const REGISTERED_SET = REGISTERED_CAPABILITY_CATEGORY_SET;

export function isRegisteredCapabilityCategory(category: string): boolean {
  return REGISTERED_SET.has(category);
}

/**
 * 批次 2 Workflow（W003/W004/W007/W052/W053/W055/W056）将用到、但 Definition 尚未注册的副作用类分类。
 * Definition 注册后这些分类会自动出现在 `buildCapabilityCatalog`；此前管理员授权页（`grantableCategories`）
 * 读这一份，才能提前授予（默认仍是只读——没有配置行 = `read` 封顶，ADR-120 #2）。
 * 必须是已登记分类（测试核对）。`docs.publish` 在 W055 里只登记不执行，仍列出以便文控集成上线后直接授权。
 */
export const PLANNED_WORKFLOW_SIDE_EFFECT_CATEGORIES: readonly string[] = Object.freeze([
  "board.write",
  "docs.publish",
  "kb.publish",
  "knowledge.graph.write",
  "project.member.write",
  "project.write",
  "tracker.write",
  "ticket.write",
]);
