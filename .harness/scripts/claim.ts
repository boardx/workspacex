// claim.ts — agent 原子认领 feature
// pnpm harness claim --phase NN --feature F01 --owner claude
// 认领规则：feature 必须 not_started 且 owner=null，否则拒绝
// 认领后：owner=<agent-id>，status=in_progress（每个 owner 只能有一个 in_progress）
//
// #1094：--feature 也可以是占位 id（`F-TBD-<slug>`）——那说明这条还没取号，
// 正式编号在**本命令写盘的那一刻**才分配（方案 B）。编号的分配点与使用点必须重合：
// 「开工前先挑个 max+1」的号要等数小时才落盘，那段时间里 main 会涨好几个号，
// 撞号是常态不是意外（见 lib/feature-id.ts 顶部）。

import { loadFeatureList, saveFeatureList, findFeature, writeActiveFeatures } from "./lib/features";
import { allocateFeatureId, isPlaceholderFeatureId } from "./lib/feature-id";
import { phaseFeatureArchivePath, phaseFeatureListPath } from "./lib/paths";
import { refreshProgress } from "./lib/progress";
import { loadHarnessConfig } from "./lib/config";
import { resolveSpecRef } from "./lib/spec-ref";
import { assertDesignSignedOff, signoffFilesCovering } from "./lib/design-signoff";
import { req } from "./lib/args";
import { log, die } from "./lib/log";
import type { Args } from "./lib/args";

export function claim(args: Args): void {
  const phaseId = req(args, "phase");
  const featureId = req(args, "feature");
  const owner = req(args, "owner");

  const fl = loadFeatureList(phaseId);
  const f = findFeature(fl, featureId);
  const cfg = loadHarnessConfig();

  // 保护 0：没有可追溯的 story（requirements/ 下的章节）不能开工（人类拍板 2026-07-19）。
  // 认领是"开始工作"的第一个机械动作，是堵住"无 story 就动手"最早也最便宜的地方。
  if (cfg.gates.spec_ref_required) {
    const r = resolveSpecRef(phaseId, f.spec_ref);
    if (!r.ok) {
      die(
        `${featureId} 不能认领：${r.reason}\n` +
          `  先在 phases/phase-${phaseId}-*/requirements/ 下补一份 story（用 .harness/templates/requirements.template.md），` +
          `再把 feature_list.json 里 ${featureId} 的 spec_ref 填成 "<文件名>.md#R<n>"；` +
          `若本 feature 属于契约先行的束（先签核、后补 requirements story），` +
          `可改填 "contracts/<束>#confirmed"（前提：该束 design-signoff.md 的 status 已是 confirmed）。`
      );
    }
  }

  // 保护 0.5：设计签核（ADR-023 决策六）。
  // 「开工前必须签核」此前只守 new-sprint 一个入口，而**真正的开工动作是 claim**：
  // 手改 feature_list.json 的 sprint 字段就能把新 feature 塞进已建 sprint，
  // 然后 claim 一路放行——那道门等于没有。这里补上同一道判定（同一个函数，不是第二份实现）。
  try {
    assertDesignSignedOff(phaseId, [featureId]);
  } catch (e) {
    die((e as Error).message);
  }

  // 保护 1：不能认领已被他人持有的 feature
  if (f.owner !== null && f.owner !== owner) {
    die(`${featureId} 已被 ${f.owner} 认领，${owner} 无法抢占`);
  }

  // 保护 2：不能认领已 passing 的 feature
  if (f.status === "passing") {
    die(`${featureId} 已是 passing，不能重新认领`);
  }

  // 保护 3：同一 owner 同时只能有一个 in_progress
  const ownerInProgress = fl.features.filter(
    (x) => x.owner === owner && x.status === "in_progress" && x.id !== featureId
  );
  if (ownerInProgress.length > 0) {
    die(
      `${owner} 已有 in_progress 的 feature：${ownerInProgress.map((x) => x.id).join(", ")}。` +
        `同一 owner 同时只能认领一个 feature。`
    );
  }

  // 取号（#1094）：所有门都过了才取，被拒的 claim 不应该消耗一个编号。
  // 取号自带锁 + 锁内重读 + 写回核对，见 lib/feature-id.ts。
  let effectiveId = featureId;
  if (isPlaceholderFeatureId(featureId)) {
    const alloc = allocateFeatureId({
      listPath: phaseFeatureListPath(phaseId),
      archivePath: phaseFeatureArchivePath(phaseId),
      placeholderId: featureId,
      // `covers:` 点名过这个占位 id 的签核文件要一起改，否则这条 feature 一取号
      // 就"不属于任何契约束"了（上面第 0.5 道门用的就是同一份判定）。
      referenceFiles: signoffFilesCovering(phaseId, featureId),
    });
    effectiveId = alloc.id;
    log.ok(`取号：${featureId} → ${effectiveId}（第 ${alloc.attempts} 次尝试）`);
    for (const p of alloc.renamedReferences) log.info(`  已同步改写引用：${p}`);
    log.info(`从现在起一律用 ${effectiveId}：分支名、commit message、测试 describe、evidence 文件名都以它为准。`);
  }

  // 执行认领。**重新读一次**：取号刚刚写过盘，此刻内存里的 fl 已经是旧的
  //（AGENTS.md「静态痕迹 ≠ 动态事实」），拿它回写会把刚分配的号抹掉。
  const fresh = loadFeatureList(phaseId);
  const target = findFeature(fresh, effectiveId);
  target.owner = owner;
  target.status = "in_progress";

  saveFeatureList(phaseId, fresh);

  // 如果 feature 在某个 sprint，刷新 active-features 视图
  if (target.sprint) {
    writeActiveFeatures(phaseId, target.sprint, fresh);
  }

  refreshProgress();
  log.ok(`${owner} 已认领 ${effectiveId}（${target.title}）`);
  log.info(`状态：in_progress | owner：${owner}`);
  log.info(`开始工作前请先读：pnpm harness verify --sprint ${phaseId}/${target.sprint ?? "?"} --feature ${effectiveId}`);
}
