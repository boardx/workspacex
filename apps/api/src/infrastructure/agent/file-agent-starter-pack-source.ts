import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentStarterPackSource } from "../../application/agent-import/ports";

export class FileAgentStarterPackSource implements AgentStarterPackSource {
  constructor(private readonly root: string | undefined) {}
  async load(packId: string, packVersion: string): Promise<unknown | null> {
    if (!this.root) return null;
    try { return JSON.parse(await readFile(join(this.root, packId, `${packVersion}.json`), "utf8")) as unknown; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }
}
