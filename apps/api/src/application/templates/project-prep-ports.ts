/**
 * F24 的仓储端口 —— `getProjectPrep` 读边界（由 `application` 定义，`infrastructure` 实现）。
 *
 * 只有一个读方法：四类各自的条目数从各自领域的真实存储里数出来（议程环节表已在 F23 落地，
 * 分组/材料/会前任务的表由 F25-F28 建立）。本端口不预判「怎么数」，只声明「数完之后长什么样」——
 * 这样 F25-F28 落地各自的表时，只需要把这个端口的实现补完整，不需要回头改 F24 的用例代码。
 */
import type { ProjectPrepCounts } from "../../domain/templates/project-prep";
import type { OrgId } from "../../domain/org-id";

export interface ProjectPrepRepository {
  /** null = 项目不存在或调用者越权可见——两者在外部必须不可分辨,统一映射到 `NO_PROJECT_ROLE`。
   *  2026-08-16（F950，delta）：加 `orgId`——同 `save-and-sync-topic-ports.ts` 那条注释，
   *  此前只有内存假仓储，接真 Postgres 才需要租户范围。 */
  loadCounts(orgId: OrgId, projectId: string): Promise<ProjectPrepCounts | null>;
}

export const PROJECT_PREP_REPOSITORY = Symbol("ProjectPrepRepository");
