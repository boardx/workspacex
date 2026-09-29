/**
 * `StarterPackImportFollowUp` 的实现：导入成功后，把**引用了 Skill、且全部引用此刻都能在本组织目录解析**
 * 的内置 Workflow Definition 发布进本组织（`publishBuiltInWorkflowDefinitions` = UC-WR-1 同一套发布校验，
 * 以导入的管理员身份；已发布且内容相同 → 幂等）。
 *
 * 只挑「现在可满足」的那些：仍缺 Skill 的 Definition 不去 ensure/publish（不给本组织留空的 definition 行），
 * 不引用 Skill 的演示 Definition 与导入无关，也不碰——它们由 dev-mode 种子负责。
 */
import { Logger } from "@nestjs/common";
import type { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";
import type { DatabasePort } from "../../application/ports/database.port";
import type { StarterPackImportFollowUp } from "../../application/skill-import/ports";
import { publishBuiltInWorkflowDefinitions } from "../../application/workflow/publish-built-in-definitions";
import type { SkillVersionResolverPort } from "../../application/workflow/workflow-ports";
import { builtInWorkflowDefinitions, defaultCommandWorkflowGraphs, defaultWorkflowGraphs } from "./create-workflow-runtime";
import { PgSkillCatalogVersionResolver } from "./pg-skill-catalog-version-resolver";
import { PgWorkflowDefinitionRepository } from "./pg-workflow-definition-repository";
import { WorkflowGraphRegistry } from "./workflow-graph-registry";

async function satisfiable(skills: SkillVersionResolverPort, orgId: string, def: WorkflowDefinitionVersionInput): Promise<boolean> {
  const refs = def.stages.flatMap((stage) => stage.skills);
  if (refs.length === 0) return false;
  for (const ref of refs) if ((await skills.resolve(orgId, ref.stableId, ref.versionRange)) === null) return false;
  return true;
}

export class PublishBuiltInWorkflowsAfterImport implements StarterPackImportFollowUp {
  private readonly logger = new Logger("PublishBuiltInWorkflowsAfterImport");

  constructor(
    private readonly db: DatabasePort,
    private readonly definitions: () => readonly WorkflowDefinitionVersionInput[] = builtInWorkflowDefinitions,
  ) {}

  async afterImport(input: { readonly orgId: string; readonly actorId: string }): Promise<void> {
    const skills = new PgSkillCatalogVersionResolver(this.db);
    const ready: WorkflowDefinitionVersionInput[] = [];
    for (const def of this.definitions()) if (await satisfiable(skills, input.orgId, def)) ready.push(def);
    if (ready.length === 0) return;
    const repo = new PgWorkflowDefinitionRepository(this.db);
    try {
      const results = await publishBuiltInWorkflowDefinitions(
        {
          definitions: repo,
          catalog: repo,
          graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs(), defaultCommandWorkflowGraphs()),
          skills,
          clock: { nowIso: () => new Date().toISOString() },
        },
        { orgId: input.orgId, actor: { userId: input.actorId, orgRole: "admin" }, definitions: ready },
      );
      const unavailable = results.filter((r) => r.outcome === "unavailable").map((r) => r.key);
      if (unavailable.length > 0) this.logger.warn(`built-in workflows still unavailable after import: ${unavailable.join(", ")}`);
    } catch (error) {
      this.logger.warn(`publishing built-in workflows after starter-pack import failed (${error instanceof Error ? error.name : "unknown"})`);
      throw error;
    }
  }
}
