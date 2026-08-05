import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillStarterPackSource } from "../../application/skill-import/ports";

/**
 * Reads only deployment-configured packs. There is deliberately no product default directory
 * and no embedded candidate list: an unset root means "no configured pack", never fallback.
 */
export class FileSkillStarterPackSource implements SkillStarterPackSource {
  constructor(private readonly root: string | undefined) {}

  async load(packId: string, packVersion: string): Promise<unknown | null> {
    if (!this.root) return null;
    try {
      const text = await readFile(join(this.root, packId, `${packVersion}.json`), "utf8");
      return JSON.parse(text) as unknown;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      // A configured-but-malformed manifest exists, so report it as an invalid verified
      // input (and retain failed provenance) rather than pretending the pack was absent.
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }
}
