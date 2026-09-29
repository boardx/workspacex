import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentStarterPackSource } from "../../application/agent-import/ports";
import { OFFICIAL_AGENT_ROLE_PACK_ID, OFFICIAL_AGENT_ROLE_PACK_VERSION, buildOfficialAgentRolePack } from "../../domain/agent/official-role-packs";

/**
 * 磁盘上 `<root>/<packId>/<packVersion>.json` 优先；磁盘上没有（或 `AGENT_STARTER_PACK_ROOT` 未配置）时，
 * 平台随代码发货的官方角色包（`official-digitalhuman-roles@<当前版本>`）直接由
 * `buildOfficialAgentRolePack()` 产出——否则开箱即用的部署导入官方包恒为 404（实测）。
 */
export class FileAgentStarterPackSource implements AgentStarterPackSource {
  constructor(private readonly root: string | undefined) {}
  async load(packId: string, packVersion: string): Promise<unknown | null> {
    const fromDisk = await this.loadFromDisk(packId, packVersion);
    if (fromDisk !== null) return fromDisk;
    if (packId === OFFICIAL_AGENT_ROLE_PACK_ID && packVersion === OFFICIAL_AGENT_ROLE_PACK_VERSION) return buildOfficialAgentRolePack();
    return null;
  }
  private async loadFromDisk(packId: string, packVersion: string): Promise<unknown | null> {
    if (!this.root) return null;
    try { return JSON.parse(await readFile(join(this.root, packId, `${packVersion}.json`), "utf8")) as unknown; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }
}
