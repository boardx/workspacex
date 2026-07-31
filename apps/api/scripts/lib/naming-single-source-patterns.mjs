/**
 * naming-single-source-patterns.mjs -- the one place the F121 败选名单集合 is written down.
 *
 * F121: 议程环节命名单源收敛。Q-3 B 裁「① 改名对齐」判负三个败选名：
 *   - `stepId` / `step_id`（phase-00 落库的驼峰/蛇形环节字段名）
 *   - `agenda_stage`（uc-2-2 一度并存的另一个字段名）
 *   - `stage.<action>`（旧的闭集动作词前缀，例如 `stage.advance`）
 * 全局单源改为 `agendaSegment` / `agendaSegmentId`（D-03a）。
 *
 * This module is imported by BOTH `lint-naming-single-source.mjs` (the CLI gate that
 * `pnpm --filter api run lint` runs) and `tests/project/naming-single-source-gate.test.ts`
 * (the counter-proof that the gate's judge function is not vacuous). Duplicating the
 * pattern list in each would be exactly the "same fact in two places" this feature exists
 * to collapse -- so there is exactly one definition, here.
 *
 * ⚠ Deliberately NOT exempting comments: unlike `lint-permission-paths.mjs` (where a
 *   comment naming a table is documentation of a rule, not a violation of it), F121's
 *   `user_visible_behavior` requires the three names to be absent EVERYWHERE in scope --
 *   including prose -- because a stale "commitment pending" comment rendered on screen
 *   (`skill-app.tsx`) is precisely the failure mode `MIGRATION-IMPACT.md` §3.2③ called out.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Each pattern is matched with a fresh RegExp per call site (`g` flags carry `lastIndex`
 * state across calls, which is how a stateful shared regex silently starts skipping
 * matches -- this project has been bitten by exactly that class of bug before).
 */
export const FORBIDDEN_NAME_SOURCES = [
  { name: "stepId（驼峰败选名）", source: "\\bstepId\\b" },
  { name: "step_id（蛇形败选名）", source: "\\bstep_id\\b" },
  { name: "agenda_stage（败选名）", source: "\\bagenda_stage\\b" },
  // 闭集动作词（project-role-matrix.ts 曾经的六个 `stage.*` 成员），逐词枚举而不是
  // `\bstage\.[A-Za-z]`：后者会把 `interview-stage.tsx` 这类无关文件名误判为违规
  // （`stage.tsx` 恰好匹配「stage. 后跟字母」），而动作词本来就是一个闭集，枚举它
  // 不是黑名单挡不住下一个名字的那种脆弱——它是这个门控唯一要禁的东西。
  {
    name: "stage.<action>（旧动作词前缀）",
    source: "\\bstage\\.(advance|broadcast|timer|group|bulkConfirm|selfDestruct)\\b",
  },
];

/**
 * @typedef {{ pattern: string, line: number, text: string, file?: string }} NamingViolation
 */

/**
 * One violation: which pattern fired, on which 1-based line, with the line's own text.
 * @param {string} text
 * @returns {NamingViolation[]}
 */
export function scanTextForForbiddenNames(text) {
  const violations = [];
  const lines = text.split("\n");
  for (const { name, source } of FORBIDDEN_NAME_SOURCES) {
    const re = new RegExp(source, "g");
    lines.forEach((line, i) => {
      if (re.test(line)) violations.push({ pattern: name, line: i + 1, text: line.trim() });
      re.lastIndex = 0; // `test` on a `g`-flagged regex advances lastIndex; reset per line.
    });
  }
  return violations;
}

const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(dir, extensions, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      walk(p, extensions, out);
    } else if (extensions.has(n.slice(n.lastIndexOf(".")))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Scan every `.ts`/`.tsx` file under each root (recursively), skipping any absolute path
 * that is itself in `excludeFiles` (used to keep this gate's own counter-proof fixture,
 * which deliberately CONTAINS a forbidden name as a string literal, from failing itself).
 * @param {string[]} roots
 * @param {string[]} [excludeFiles]
 * @returns {NamingViolation[]}
 */
export function scanTreesForForbiddenNames(roots, excludeFiles = []) {
  const excluded = new Set(excludeFiles);
  const violations = [];
  for (const root of roots) {
    for (const file of walk(root, DEFAULT_EXTENSIONS)) {
      if (excluded.has(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const v of scanTextForForbiddenNames(text)) {
        violations.push({ ...v, file });
      }
    }
  }
  return violations;
}
