// archive-passing.ts — 把某 phase 里已 passing 的 feature 从 feature_list.json 搬到
// feature_list.archive.json，只是搬家、不是复制第二份事实源（passing 不可逆，见 AGENTS.md）。
// 动机：feature_list.json 会随阶段推进无限增长，而绝大多数行数是已冻结、不会再变的
// passing 记录；把它们挪出去能让 live 文件长期保持在人类/agent 可整篇阅读的规模。
// lib/features.ts 的 loadFeatureList 会透明合并 live + archive；saveFeatureList 只写 live，
// 且会自动过滤掉已归档的 id——常规调用方（claim/verify/sweep-unblock…）不需要感知这个分层。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { phaseFeatureListPath, phaseFeatureArchivePath } from "./lib/paths";
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import type { Feature, FeatureList } from "./lib/types";

export function archivePassing(args: Args): void {
  const phaseId = args.opts["phase"];
  if (!phaseId) throw new Error("缺少必填参数 --phase");
  const dryRun = !!args.flags["dry-run"];

  const livePath = phaseFeatureListPath(phaseId);
  const archivePath = phaseFeatureArchivePath(phaseId);

  const live = JSON.parse(readFileSync(livePath, "utf8")) as FeatureList;
  if (!Array.isArray(live.features)) throw new Error(`feature_list 结构非法: ${livePath}`);

  const toArchive = live.features.filter((f) => f.status === "passing");
  const remaining = live.features.filter((f) => f.status !== "passing");

  if (toArchive.length === 0) {
    log.info(`${phaseId}: 没有新的 passing feature 需要归档。`);
    return;
  }

  const existingArchive: FeatureList = existsSync(archivePath)
    ? (JSON.parse(readFileSync(archivePath, "utf8")) as FeatureList)
    : { phase: live.phase, features: [] };
  if (!Array.isArray(existingArchive.features)) {
    throw new Error(`feature_list 归档结构非法: ${archivePath}`);
  }

  const seen = new Set(existingArchive.features.map((f) => f.id));
  const newlyArchived = toArchive.filter((f) => !seen.has(f.id));
  const mergedArchive: Feature[] = [...existingArchive.features, ...newlyArchived].sort(
    (a, b) => a.priority - b.priority
  );

  log.info(`${phaseId}: ${newlyArchived.length} 个 feature 将从 feature_list.json 移入 feature_list.archive.json：`);
  for (const f of newlyArchived) log.ok(`  ${f.id}（${f.title}）`);

  if (dryRun) {
    log.info(`[dry-run] live 剩余 ${remaining.length} 条，archive 累计 ${mergedArchive.length} 条，未写入`);
    return;
  }

  writeFileSync(archivePath, JSON.stringify({ phase: live.phase, features: mergedArchive }, null, 2) + "\n", "utf8");
  writeFileSync(livePath, JSON.stringify({ ...live, features: remaining }, null, 2) + "\n", "utf8");

  log.info(`完成：live ${live.features.length} → ${remaining.length} 条，archive 累计 ${mergedArchive.length} 条。`);
}
