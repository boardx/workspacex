/**
 * F121: 议程环节命名单源收敛 —— 败选名门控（含反证）。
 * (Q-3 B 裁「① 改名对齐」, contracts/project/domain.md I-P20, MIGRATION-IMPACT.md 第二节)
 *
 * ⚠ 反证优先：`domain.md` 明写 —— 「一条 grep 门控...⚠ 反证：断言该门控对一个故意植入
 * 败选名的字符串返回失败（否则一个『什么都不扫』的 grep 也全绿）」。本文件因此先证明
 * 判定函数本身会红（②），再用它去扫真实的仓库树（①）——顺序颠倒会让①的「0 处」
 * 读起来像覆盖，其实什么都没扫到。
 *
 * 判定函数与被扫的目录清单是**单源**：都来自
 * `scripts/lib/naming-single-source-patterns.mjs`，`lint-naming-single-source.mjs`
 * （`pnpm --filter api run lint` 的一部分）与本测试共享同一份，不各写一份正则。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanTextForForbiddenNames,
  scanTreesForForbiddenNames,
} from "../../scripts/lib/naming-single-source-patterns.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = join(HERE, "..", "..");
const REPO = join(API, "..", "..");
const THIS_FILE = fileURLToPath(import.meta.url);

describe("反证：判定函数不是空转 —— 故意喂败选名，必须返回失败", () => {
  it("stepId（驼峰）被判定为违规", () => {
    const violations = scanTextForForbiddenNames('export interface X { stepId: string }');
    expect(violations.some((v) => v.pattern.includes("stepId"))).toBe(true);
  });

  it("step_id（蛇形）被判定为违规", () => {
    const violations = scanTextForForbiddenNames("SELECT step_id FROM artifact_bindings");
    expect(violations.some((v) => v.pattern.includes("step_id"))).toBe(true);
  });

  it("agenda_stage 被判定为违规", () => {
    const violations = scanTextForForbiddenNames("const agenda_stage = row.agenda_stage;");
    expect(violations.some((v) => v.pattern.includes("agenda_stage"))).toBe(true);
  });

  it("stage.<action> 前缀动作词被判定为违规", () => {
    const violations = scanTextForForbiddenNames('action: "stage.advance"');
    expect(violations.some((v) => v.pattern.includes("stage."))).toBe(true);
  });

  it("四种败选名同时出现在一份文本里 —— 四条都各自命中，不是互相吞掉", () => {
    const fixture = [
      "readonly stepId: string;",
      "readonly step_id: string;",
      'const agenda_stage = "x";',
      'action: "stage.timer"',
    ].join("\n");
    const violations = scanTextForForbiddenNames(fixture);
    const patterns = new Set(violations.map((v) => v.pattern));
    expect(patterns.size).toBe(4);
  });

  it("裸词 `stage` 或 `step`（不带 . 或 _id/驼峰后缀）不是败选名 —— 门控不是在禁用英文单词", () => {
    // "cannot advance the stage for everyone" / "findByStep" 这类合法散文与方法名不应被误判。
    const violations = scanTextForForbiddenNames(
      "// they cannot advance the stage for everyone\nfindByStep(orgId, artifactId);",
    );
    expect(violations).toEqual([]);
  });

  it("干净文本（用新名）不触发任何一条", () => {
    const violations = scanTextForForbiddenNames(
      'readonly agendaSegmentId: string;\naction: "agendaSegment.advance";',
    );
    expect(violations).toEqual([]);
  });
});

describe("①正向：全仓（scope 内）真的一处败选名都搜不到", () => {
  it("apps/api/src + apps/api/tests + apps/web + packages/contracts/src 干净", () => {
    const roots = [
      join(API, "src"),
      join(API, "tests"),
      join(REPO, "apps/web"),
      join(REPO, "packages/contracts/src"),
    ];
    // 排除本文件自己 —— 上面的反证测试故意把败选名当字符串字面量写在这里,
    // 这是本门控的判据材料,不是对它自己的违反。
    const violations = scanTreesForForbiddenNames(roots, [THIS_FILE]);
    const summary = violations.map((v) => `${v.file}:${v.line} ${v.pattern} -- ${v.text}`).join("\n");
    expect(violations, `发现败选名残留:\n${summary}`).toEqual([]);
  });

  it("反证的反证：本文件如果不被排除，会让上面那条测试变红", () => {
    // 证明「排除自己」这个动作没有把门控变成扫空目录 —— 把本文件自己也纳入扫描,
    // 断言它确实会被命中(因为它自己就含四个败选名字面量)。
    const violations = scanTreesForForbiddenNames([API], []);
    const self = violations.filter((v) => v.file === THIS_FILE);
    expect(self.length).toBeGreaterThan(0);
  });
});

describe("门控脚本与测试共享同一份判定 —— 不是两份正则各写各的", () => {
  it("lint-naming-single-source.mjs 确实 import 了同一个模块", () => {
    const script = readFileSync(join(API, "scripts/lint-naming-single-source.mjs"), "utf8");
    expect(script).toContain("./lib/naming-single-source-patterns.mjs");
  });
});
