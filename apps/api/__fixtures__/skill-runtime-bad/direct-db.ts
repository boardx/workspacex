/**
 * 反证 fixture（**故意违规**，不参与编译：`tsconfig.json` 已 exclude `__fixtures__`）。
 *
 * 「skill 运行时直连业务库」——I-25 要挡的第一种形态。
 * 注意它在 application 层、也没 import 任何 `infrastructure/`，
 * 所以既有的 `lint-arch-deps` 对它一声不吭。
 */
import { Pool } from "pg";

export async function loadSkillContext(orgId: string) {
  const pool = new Pool();
  return pool.query("select * from context_items where org_id = $1", [orgId]);
}
