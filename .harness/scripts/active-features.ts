/**
 * active-features.ts —— `pnpm harness active-features`（#401）
 *
 * 开工流程第 2 步「找到唯一 in_progress 的 feature」的入口。
 *
 * 为什么需要它：`active-features.json` 是脚本派生的只读投影，被 .gitignore 忽略
 * （H3A-009：投影不入库，否则会漂移成第二份事实源），所以**干净 clone 上它根本
 * 不存在**。指令文档却让 agent 直接去读那个文件——第一次进来的 agent 必然读空。
 * 这条命令把那一步变成可复现的动作：从权威 `feature_list.json` 重建投影，并把
 * 「现在谁在做哪个 feature」直接打印出来。
 *
 * 用法：
 *   pnpm harness active-features                      # 全仓重建 + 打印全部 in_progress
 *   pnpm harness active-features --phase 11            # 只看某阶段
 *   pnpm harness active-features --phase 11 --sprint 02
 *
 * 遍历的是**阶段目录**而不是阶段 id：phases/ 下允许出现 id 相同的两个目录
 * （今天的 phase-16-*），按 id 走会漏掉其中一个阶段的 in_progress。
 *
 * 判定逻辑（视图内容、确定性、in_progress 排序）在 lib/startup-discovery.ts，
 * 本文件只做 IO 与打印。
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import {
  REPO_ROOT,
  listPhaseDirs,
  findPhaseDir,
  featureListPathIn,
  sprintDirIn,
  phaseIdFromDir,
} from "./lib/paths";
import { loadFeatureListIn, writeActiveFeaturesIn } from "./lib/features";
import { inProgressFeatures, ACTIVE_FEATURES_REGEN_CMD } from "./lib/startup-discovery";
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import type { Feature } from "./lib/types";

interface Row {
  phaseId: string;
  sprintId: string;
  feature: Feature;
}

export function activeFeatures(args: Args): void {
  const phaseOpt = args.opts["phase"];
  const sprintOpt = args.opts["sprint"];

  const phaseDirs = (phaseOpt ? [findPhaseDir(phaseOpt)] : listPhaseDirs()).filter((d) =>
    existsSync(featureListPathIn(d)),
  );

  if (phaseDirs.length === 0) {
    // 空集防线：一个权威清单都没读到不是「全绿」，是这条命令什么也没证明。
    log.err(`没有读到任何 feature_list.json（--phase=${phaseOpt ?? "全部"}）——权威源缺失，拒绝下结论`);
    process.exitCode = 1;
    return;
  }

  const rebuilt: string[] = [];
  const missingSprintDirs: string[] = [];
  const inProgress: Row[] = [];

  for (const phaseDir of phaseDirs) {
    const phaseId = phaseIdFromDir(phaseDir);
    const fl = loadFeatureListIn(phaseDir);

    const sprintIds = [...new Set(fl.features.map((f) => f.sprint).filter((s): s is string => !!s))]
      .filter((s) => (sprintOpt ? s === sprintOpt : true))
      .sort();

    for (const sprintId of sprintIds) {
      if (!existsSync(sprintDirIn(phaseDir, sprintId))) {
        missingSprintDirs.push(`phase-${phaseId}/sprint-${sprintId}`);
        continue;
      }
      rebuilt.push(relative(REPO_ROOT, writeActiveFeaturesIn(phaseDir, sprintId, fl)));
    }

    for (const f of inProgressFeatures(fl.features)) {
      if (sprintOpt && f.sprint !== sprintOpt) continue;
      inProgress.push({ phaseId, sprintId: f.sprint ?? "(未分配 sprint)", feature: f });
    }
  }

  log.step(`从权威 feature_list.json 重建 sprint 派生视图（${rebuilt.length} 份，不入库）`);
  for (const r of rebuilt) log.info(`   ${r}`);
  for (const m of missingSprintDirs) {
    log.warn(`${m}: feature 指向的 sprint 目录不存在，跳过重建（改 feature_list.json 的 sprint 字段，或补 new-sprint）`);
  }

  log.step("开工流程第 2 步：当前 in_progress 的 feature");
  if (inProgress.length === 0) {
    log.info("   (无) —— 先跑 `pnpm harness readiness` 从统一队列顶部取活，再 `pnpm harness claim`");
    return;
  }
  for (const row of inProgress) {
    const owner = row.feature.owner ?? "(无 owner)";
    log.info(`   phase-${row.phaseId}/sprint-${row.sprintId}  ${row.feature.id}  owner=${owner}  ${row.feature.title}`);
  }
  log.info(`（视图已重建；任何时候想刷新，重跑 \`${ACTIVE_FEATURES_REGEN_CMD}\`。权威源始终是 feature_list.json）`);
}
