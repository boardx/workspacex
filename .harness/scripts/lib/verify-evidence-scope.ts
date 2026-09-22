// verify-evidence-scope.ts — verify 的「写作用域」判定（#1025）
//
// 病根（#1025 / #1030 同源）：`verify --sprint` 对**不是本次任务对象的 feature**
// 做写操作。#1030（已修）是写 status；本模块修的是另一半——写 evidence：
// sprint 全量 verify 会把它扫到的每一个 feature 的 `evidence/<Fxx>.verify.log`
// **覆写成本次运行的输出（失败的运行同样覆写）**，于是一个 agent 的失败日志
// 盖掉另一个 agent 的审计材料，且完全静默、极易被 `git add -A` 顺手带进 PR。
//
// 判定规则（coord-main 2026-08-12 批）：默认只写「`--feature` 指定的」或
// 「本 owner（`--owner`）名下的」feature；要写别人的需显式 `--all`。
//
// 注意：本模块只回答「这个 feature 是不是本次任务对象」，不回答「验证过没过」。
// 不在作用域内的 feature 由 verify 整条跳过（不跑命令、不落证据、不翻状态）——
// 若只跳过写盘却照常判定，通过时会落下一个指向陈旧/不存在日志的 evidence 指针，
// 那是比覆写更坏的假证据。
import type { Feature } from "./types";

export interface EvidenceScopeOptions {
  /** `--feature Fxx`：本次显式指定的单个 feature（null = 未指定） */
  only: string | null;
  /** `--owner <id>`：本次运行的 owner 身份（null = 未声明身份） */
  owner: string | null;
  /** `--all`：显式要求连别人名下的 feature 一起写 */
  all: boolean;
}

export interface SkippedFeature {
  id: string;
  owner: string | null;
}

export interface ScopePartition {
  /** 本次任务对象：跑验证、落证据、按门控翻状态 */
  inScope: Feature[];
  /** 非本次任务对象：整条跳过，一个字节都不写 */
  skipped: SkippedFeature[];
}

/** 这个 feature 是不是本次运行的任务对象（= 允许对它做写操作）。 */
export function isInWriteScope(f: Feature, o: EvidenceScopeOptions): boolean {
  // --all：显式越权，放行（失败写入另有告警，见 nonOwnerWriteWarning）
  if (o.all) return true;
  // --feature 点名的那一条，就是本次任务对象
  if (o.only !== null && f.id === o.only) return true;
  // 声明了身份：只认自己名下的
  if (o.owner !== null) return f.owner === o.owner;
  // 没声明身份：只认无主的（单 agent 模式的旧行为——无主 feature 不存在「别人的证据」）
  return f.owner === null;
}

export function partitionByWriteScope(features: Feature[], o: EvidenceScopeOptions): ScopePartition {
  const inScope: Feature[] = [];
  const skipped: SkippedFeature[] = [];
  for (const f of features) {
    if (isInWriteScope(f, o)) inScope.push(f);
    else skipped.push({ id: f.id, owner: f.owner });
  }
  return { inScope, skipped };
}

/** 跳过必须出声：静默跳过会制造新的「以为验过了」的错觉（#1025 原文点名要求）。 */
export function describeSkipped(skipped: SkippedFeature[], o: EvidenceScopeOptions): string | null {
  if (skipped.length === 0) return null;
  const shown = skipped
    .slice(0, 5)
    .map((s) => `${s.id}(owner=${s.owner ?? "null"})`)
    .join(", ");
  const more = skipped.length > 5 ? ` …等 ${skipped.length} 个` : "";
  const hint =
    o.owner === null
      ? "如需验证自己名下的 feature 加 --owner <你的-agent-id>，点名单条用 --feature Fxx，全量（会覆写别人的证据）用 --all"
      : "如需点名单条用 --feature Fxx，全量（会覆写别人的证据）用 --all";
  return `已跳过 ${skipped.length} 个非本次任务对象的 feature：${shown}${more}。${hint}`;
}

/** `--all` / `--feature` 写到别人名下且验证未通过时的额外告警（#1025 补充建议）。 */
export function nonOwnerWriteWarning(f: Feature, o: EvidenceScopeOptions, ok: boolean): string | null {
  if (ok) return null;
  if (o.owner !== null && f.owner === o.owner) return null;
  if (o.owner === null && f.owner === null) return null;
  return (
    `⚠ 刚把一次**失败**的运行写进了非本 owner 的证据：${f.id}（owner=${f.owner ?? "null"}）。` +
    `evidence 是审计链的根，提交前请确认这不是误伤（git status 会显示该文件被改）。`
  );
}
