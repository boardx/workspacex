/**
 * #1142 棘轮门跑在**仓库真实数据**上的体检：证明落地那一刻的快照是完整的，
 * 而且这道门确实是「满棘轮之外还剩多少存量」这件事的唯一记账处。
 *
 * 这不是重复 feature-owner.test.ts（那里是纯函数反证）。这里守的是另一件事：
 * 名单与真实数据**对不上**时立刻红——少一条 ⇒ doctor 会突然冒出一条谁也没预料到的
 * FAIL；多一条 ⇒ 一个取值被留下一扇没人看守的门。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./paths";
import { loadRoadmap } from "./roadmap";
import { loadFeatureList } from "./features";
import { readKnownAgentIdentities } from "./agent-identity";
import { judgeFeatureOwners, staleOwnerAllowlistEntries, type PhaseFeatureOwners } from "./feature-owner";

const ALLOWLIST_PATH = join(STATE_DIR, "feature-owner-allowlist.json");

function readAllowlist(): string[] {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  const doc = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as { entries?: unknown };
  return Array.isArray(doc.entries) ? (doc.entries as string[]) : [];
}

function scanPhases(): PhaseFeatureOwners[] {
  const out: PhaseFeatureOwners[] = [];
  for (const p of loadRoadmap().phases) {
    try {
      out.push({ phaseId: p.id, features: loadFeatureList(p.id).features });
    } catch { /* roadmap 里已规划但还没 scaffold 的 phase，跳过（同 doctor.ts） */ }
  }
  return out;
}

describe("#1142 owner 棘轮：仓库现状", () => {
  const phases = scanPhases();
  const known = new Set(readKnownAgentIdentities().keys());
  const allowlist = readAllowlist();

  it("扫描不会空转（真读到了 feature）", () => {
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.reduce((n, p) => n + p.features.length, 0)).toBeGreaterThan(100);
  });

  // 反证：把 allowlist 清空 ⇒ 本条红（243 条存量全部变成 newGaps）。
  // 这条同时保证「今天之后新增的非法 owner」会被 doctor 判红——
  // 它红的时候，红的就是新增的那一条。
  it("落地快照完整：今天没有任何未登记的非法 owner", () => {
    const v = judgeFeatureOwners(phases, known, allowlist);
    expect(v.newGaps.map((g) => g.key)).toEqual([]);
  });

  // 反证：往 allowlist 里塞一条不存在的 feature ⇒ 本条红。
  it("名单里没有陈旧条目（棘轮只许收缩）", () => {
    expect(staleOwnerAllowlistEntries(phases, known, allowlist)).toEqual([]);
  });

  it("名单确实在豁免存量（不是一份空装饰）", () => {
    const v = judgeFeatureOwners(phases, known, allowlist);
    expect(v.grandfathered.length).toBe(allowlist.length);
    expect(v.grandfathered.length).toBeGreaterThan(0);
  });
});
