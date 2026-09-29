import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillStarterPackSource } from "../../application/skill-import/ports";

/** 仓库自带的 `skills/starter-packs/`（相对本源文件定位；`tsx src/main.ts` 与测试都从源码运行）。 */
export const REPO_SKILL_STARTER_PACK_ROOT = fileURLToPath(new URL("../../../../../skills/starter-packs/", import.meta.url));

/**
 * `SKILL_STARTER_PACK_ROOT` 的**唯一**解析点（kernel DI 与标准包自愈 seed 共用，不再各读一遍 env）。
 *
 * - 显式配置 → 用它（部署契约：生产必须显式设置，curated-capability-packs usecases「pre」）；
 * - 未配置且 `NODE_ENV !== "production"`（dev / test / 本地栈）→ 仓库自带的 `skills/starter-packs/`。
 *   此前 DI 这一侧没有任何默认，dev 栈漏配时 `/admin/skills/starter-pack-imports` 恒 404
 *   SKILL_STARTER_PACK_NOT_FOUND，而同一进程里的标准包 seed 却因为自带相对路径默认而正常——
 *   同一件事两份声明、两种行为；
 * - 生产未配置 → `undefined`（不猜目录，导入如实 404）。
 */
export function resolveSkillStarterPackRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.SKILL_STARTER_PACK_ROOT?.trim();
  if (configured !== undefined && configured !== "") return configured;
  return env.NODE_ENV === "production" ? undefined : REPO_SKILL_STARTER_PACK_ROOT;
}

/**
 * Reads only deployment-configured packs (see `resolveSkillStarterPackRoot` for the dev/test default). There is deliberately no product default directory
 * and no embedded candidate list: an unset root (production) means "no configured pack", never fallback.
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
