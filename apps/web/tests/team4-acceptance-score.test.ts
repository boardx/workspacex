/**
 * `/agent/team4` 验收打分器的门控与**反证**。
 *
 * 门控：真实仓库的分数必须 ≥ 目标线（人类要求的 9 分）。
 *
 * 反证：一个恒返回好看数字的打分器同样能让门控全绿——那是本仓最痛恨的假绿。所以这里
 * 额外证明"它真的在读被评对象的内容"：把被评文件复制到临时目录，**篡改其中一份**
 * （删掉方法论里的一段判据 / 删掉派生公式实现），用 `--repo` 对副本打分，断言分数
 * 必须下降。篡改后分数不降 = 打分器没在看那部分内容，这条测试就该红。
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(WEB, "..", "..");
const SCORER = join(WEB, "scripts", "team4-acceptance-score.mjs");

/** 人类给的目标线。打分口径见 `docs/agents/team4-acceptance-rubric.md`。 */
const TARGET = 9;

/** 被评对象——与打分器 `P` 表一致；少复制一个只会让副本基线更低，不影响"篡改后必须更低"。 */
const SCORED_FILES = [
  "apps/web/lib/post-investment/methodology.ts",
  "apps/web/lib/post-investment/agent-directory.ts",
  "apps/web/lib/post-investment/ensure-agent.ts",
  "apps/web/lib/post-investment/ensure-thread.ts",
  "apps/web/lib/post-investment/fixtures.ts",
  "apps/web/lib/post-investment/skill-identity.ts",
  "apps/web/components/agent/post-investment-chat-entry.tsx",
  "apps/web/app/agent/[teamId]/page.tsx",
  "apps/web/scripts/team4-export-fixtures.mjs",
  "apps/web/tests/team4-acceptance-score.test.ts",
  "apps/api/scripts/post-investment-skill-content.ts",
  "apps/api/src/application/post-investment/derive-financial-metrics.ts",
  "apps/api/src/infrastructure/skill/ensure-platform-skill-catalog.ts",
  "apps/api/tests/post-investment/derive-financial-metrics.test.ts",
  "packages/contracts/src/post-investment-rules.ts",
  "docs/agents/team4-post-investment-report-mvp.md",
  "docs/agents/team4-acceptance-rubric.md",
];

function score(repoRoot?: string): number {
  const args = [SCORER, "--json", ...(repoRoot ? ["--repo", repoRoot] : [])];
  const out = execFileSync(process.execPath, args, { encoding: "utf8" });
  return (JSON.parse(out) as { score: number }).score;
}

/** 复制被评文件到一个临时"仓库"，可选地在复制后篡改其中一份。 */
function makeCopy(mutate?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "team4-score-"));
  for (const rel of SCORED_FILES) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  mutate?.(root);
  return root;
}

function patch(root: string, rel: string, find: string, replaceWith: string): void {
  const p = join(root, rel);
  const before = readFileSync(p, "utf8");
  // 篡改点必须真的存在——否则这条反证什么都没证明（改了个不存在的东西，分数当然不变）。
  expect(before).toContain(find);
  // 全量替换：反证的意图是「把这个证据/判据抽掉」，只换第一处会留下别处的同名内容，
  // 分数不降就成了假的反证（实测踩过：fixtures 里同一个日期出现两次）。
  writeFileSync(p, before.replaceAll(find, replaceWith), "utf8");
}

describe("team4 验收打分器", () => {
  it("门控：真实仓库分数 ≥ 目标线", () => {
    expect(score()).toBeGreaterThanOrEqual(TARGET);
  });

  it("反证①：抽掉方法论里「标注靠哪两份材料交叉」的跨文件指令，分数必须下降", () => {
    const base = score(makeCopy());
    const mutated = score(makeCopy((root) => {
      patch(root, "apps/web/lib/post-investment/methodology.ts", "哪两份材料", "某些材料");
    }));
    expect(mutated).toBeLessThan(base);
  });

  it("反证②：删掉一个派生公式实现，分数必须下降", () => {
    const base = score(makeCopy());
    const mutated = score(makeCopy((root) => {
      patch(root, "apps/api/src/application/post-investment/derive-financial-metrics.ts",
        "export function cashRunwayMonths", "function removedCashRunway");
    }));
    expect(mutated).toBeLessThan(base);
  });

  it("反证③：把入口换回自建上传框（不进真 chat），可用性必须掉分", () => {
    const base = score(makeCopy());
    const mutated = score(makeCopy((root) => {
      patch(root, "apps/web/components/agent/post-investment-chat-entry.tsx",
        "router.replace(`/chat/", "noop(`/nowhere/");
    }));
    expect(mutated).toBeLessThan(base);
  });

  it("反证④：抽掉示例材料里的触发证据，分数必须下降", () => {
    const base = score(makeCopy());
    const mutated = score(makeCopy((root) => {
      patch(root, "apps/web/lib/post-investment/fixtures.ts", "2038年3月21日", "某个日期");
    }));
    expect(mutated).toBeLessThan(base);
  });
});
