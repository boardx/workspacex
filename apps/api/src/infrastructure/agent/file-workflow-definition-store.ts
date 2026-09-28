import { readdirSync } from "node:fs";
import type { WorkflowDefinitionStore } from "../../application/agent-import/ports";

/**
 * AG03 · 已注册 Workflow 的单一事实源 = `requirements/work-stack-v2/workflows/` 目录下的实体文档
 * （文件名前缀 `W###-`，如 `W001-research-to-brief.md`）。不新开一张复述同一份清单的 DB 表——
 * Workflow Runtime 落地注册表后按同一端口形状换一个实现即可，调用方（`importOfficialAgentRolePack`）
 * 不用跟着改。
 *
 * 无状态、不缓存：目录很小（19 个文件），每次都重新 `readdirSync`，避免长驻进程里因为缓存
 * 命中导致「刚加的 Workflow 文档要重启才生效」这类隐藏的过期状态。
 */
export class FileWorkflowDefinitionStore implements WorkflowDefinitionStore {
  constructor(private readonly root: string | undefined) {}
  async isRegistered(stableId: string): Promise<boolean> {
    if (!this.root) return false;
    try {
      return readdirSync(this.root).some((name) => name.startsWith(`${stableId}-`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
