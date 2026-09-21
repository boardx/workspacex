import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  listPhaseDirs,
  featureListPathIn,
  sprintDirIn,
  phaseIdFromDir,
} from "./lib/paths";
import { loadFeatureListIn, featuresForSprint } from "./lib/features";
import {
  ACTIVE_FEATURES_BASENAME,
  ACTIVE_FEATURES_REGEN_CMD,
  auditStartupDocs,
  buildActiveFeaturesView,
  inProgressFeatures,
  renderActiveFeaturesView,
  type StartupDoc,
} from "./lib/startup-discovery";

/**
 * lint-startup-discovery.test.ts —— #401：**开工流程第 2 步必须在干净 clone 上可复现**。
 *
 * 反证的缺陷：`.gitignore` 忽略全部 `active-features.json`（H3A-009 合同要求：
 * 投影不入库），AGENTS.md「开工流程」第 2 步却逐字让 agent 去读那个文件。
 * 新 clone 上它不存在 ⇒ 第一次进来的 agent 照做必然读空。修复前本文件第一条
 * 与第三条都是红的（文档没点名重建命令；投影带挂钟字段所以不确定）。
 *
 * 判定逻辑在 lib/startup-discovery.ts（纯函数，另有 fixture 单测）；这里做真实
 * 仓库侧的 IO：读指令文档、问 git 谁被追踪、拿真权威清单重建投影。
 */

function git(args: string[]): string[] {
  const out = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return out.split("\n").filter((l) => l.length > 0);
}

/** 开工路径上的指令文档：根路由 + 全部 skill + 全部 instructions。 */
function startupDocs(): StartupDoc[] {
  const paths = [
    "AGENTS.md",
    ...git(["ls-files", "--", ".agents/skills/**/SKILL.md"]),
    ...git(["ls-files", "--", ".harness/instructions/*.md", ".harness/instructions/**/*.md"]),
  ];
  return [...new Set(paths)].map((p) => ({ p, full: join(REPO_ROOT, p) }))
    .filter(({ full }) => existsSync(full))
    .map(({ p, full }) => ({ path: p, text: readFileSync(full, "utf8") }));
}

describe("开工流程第 2 步在干净 clone 上可复现（#401）", () => {
  it("扫到的指令文档不是空集（空集防线：没有对象不等于全绿）", () => {
    expect(startupDocs().length).toBeGreaterThan(10);
  });

  it("凡指示读 active-features.json 的指令文档，都点名了重建命令", () => {
    const findings = auditStartupDocs(startupDocs());
    expect(
      findings.map((f) => f.message).join("\n"),
      "干净 clone 上这些句子指向一个不存在的文件",
    ).toBe("");
  });

  it("文档点名的那条重建命令真的被 harness CLI 分发（不是画饼）", () => {
    const cli = readFileSync(join(REPO_ROOT, ".harness", "scripts", "cli.ts"), "utf8");
    const sub = ACTIVE_FEATURES_REGEN_CMD.replace(/^pnpm harness /, "");
    expect(cli).toContain(`case "${sub}":`);
    expect(existsSync(join(REPO_ROOT, ".harness", "scripts", `${sub}.ts`))).toBe(true);
  });

  it("修复方向没有走歪：投影仍然不入库（H3A-009），权威 feature_list.json 才被 Git 追踪", () => {
    expect(git(["ls-files", "--", `**/${ACTIVE_FEATURES_BASENAME}`])).toEqual([]);
    const trackedLists = git(["ls-files", "--", "phases/*/feature_list.json"]);
    expect(trackedLists.length).toBeGreaterThan(0);
  });

  it("只靠被 Git 追踪的权威源，就能发现唯一 in_progress 的 feature，并重建出它所在 sprint 的视图", () => {
    const tracked = new Set(git(["ls-files"]));
    let phasesSeen = 0;
    let rowsSeen = 0;

    for (const phaseDir of listPhaseDirs()) {
      const listPath = featureListPathIn(phaseDir);
      if (!existsSync(listPath)) continue;
      // 干净 clone 上能读到 ⟺ 它被 Git 追踪。
      expect(tracked.has(relative(REPO_ROOT, listPath))).toBe(true);
      phasesSeen++;

      const fl = loadFeatureListIn(phaseDir);
      for (const f of inProgressFeatures(fl.features)) {
        rowsSeen++;
        if (!f.sprint || !existsSync(sprintDirIn(phaseDir, f.sprint))) continue;
        // 投影是从同一份权威现场算出来的，不需要磁盘上已有那个文件。
        const view = buildActiveFeaturesView(phaseIdFromDir(phaseDir), f.sprint, featuresForSprint(fl, f.sprint));
        expect(view.features.map((x) => x.id)).toContain(f.id);
      }
    }

    expect(phasesSeen, "一个权威清单都没读到 ⇒ 这条断言什么也没证明").toBeGreaterThan(0);
    expect(rowsSeen, "全仓没有任何 in_progress ⇒ 发现路径未被真实数据走过").toBeGreaterThan(0);
  });

  it("用真实权威数据重建两次，字节一致，且逐字等于 feature_list 的 sprint 子集", () => {
    const phaseDir = listPhaseDirs().find((d) => {
      if (!existsSync(featureListPathIn(d))) return false;
      return loadFeatureListIn(d).features.some((f) => !!f.sprint);
    });
    expect(phaseDir, "找不到任何已分配 sprint 的阶段").toBeDefined();

    const fl = loadFeatureListIn(phaseDir!);
    const sprintId = fl.features.find((f) => !!f.sprint)!.sprint!;
    const phaseId = phaseIdFromDir(phaseDir!);
    const once = renderActiveFeaturesView(buildActiveFeaturesView(phaseId, sprintId, featuresForSprint(fl, sprintId)));
    const twice = renderActiveFeaturesView(buildActiveFeaturesView(phaseId, sprintId, featuresForSprint(fl, sprintId)));

    expect(once).toBe(twice);
    expect(JSON.parse(once).features).toEqual(featuresForSprint(fl, sprintId));
  });
});
