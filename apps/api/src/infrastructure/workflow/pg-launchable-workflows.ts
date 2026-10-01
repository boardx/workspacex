/**
 * 目录「可发起」的事实源：本组织有 published Definition 版本的内容线 Workflow（`LaunchableWorkflowsPort`）。
 * 复用 UC-WR-2 的 `listLatestPublished`（同一条读路径），key → `W0xx` 的对照只来自代码自带的内容线注册表。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { LaunchableWorkflowsPort } from "../../application/agent/list-agent-directory";
import { contentWorkflowIdOf } from "../../domain/agent/workflow-allowlist";
import type { OrgId } from "../../domain/org-id";
import { PgWorkflowDefinitionRepository } from "./pg-workflow-definition-repository";

export class PgLaunchableWorkflows implements LaunchableWorkflowsPort {
  private readonly definitions: PgWorkflowDefinitionRepository;

  constructor(db: DatabasePort) {
    this.definitions = new PgWorkflowDefinitionRepository(db);
  }

  async publishedWorkflowIds(orgId: OrgId): Promise<ReadonlySet<string>> {
    const published = await this.definitions.listLatestPublished(orgId);
    return new Set(published.flatMap((d) => { const id = contentWorkflowIdOf(d.key); return id === null ? [] : [id]; }));
  }
}
