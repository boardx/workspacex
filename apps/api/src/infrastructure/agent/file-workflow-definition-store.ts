import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDefinitionStore } from "../../application/agent-import/ports";

/** `# W001 — Research-to-Brief` → `Research-to-Brief`. Any other first line → null (fail-soft). */
const TITLE_LINE_RE = /^#\s*W\d{3}\s*[—-]\s*(.+?)\s*$/;

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

  /** AG04：卡片展示 Workflow 名字（见 ports.ts 头注）——同一份文档目录，读 H1 标题。 */
  async resolveName(stableId: string): Promise<string | null> {
    if (!this.root) return null;
    try {
      const fileName = readdirSync(this.root).find((name) => name.startsWith(`${stableId}-`));
      if (!fileName) return null;
      const firstLine = readFileSync(join(this.root, fileName), "utf8").split("\n", 1)[0] ?? "";
      const match = TITLE_LINE_RE.exec(firstLine);
      return match ? match[1]! : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
