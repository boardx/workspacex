import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";
import {
  describeSkipped,
  isInWriteScope,
  nonOwnerWriteWarning,
  partitionByWriteScope,
} from "./verify-evidence-scope";
import type { EvidenceScopeOptions } from "./verify-evidence-scope";
import type { Feature } from "./types";

/**
 * #1025：`verify --sprint` 会给它扫到的**每一个** feature 覆写 evidence 日志
 * （失败的运行也照写），于是一个 agent 的失败输出盖掉另一个 agent 的审计材料，
 * 且全程静默。coord-main 2026-08-12 裁：默认只写 `--feature` 点名的或
 * `--owner` 名下的，写别人需显式 `--all`。
 *
 * 下面第一条直接复刻事故现场（2026-08-12 dev-project 收口 F158，
 * 同 sprint 并存 F34/owner=w2-files2 与 F50/owner=w2-model）。
 */

function feature(id: string, owner: string | null): Feature {
  return {
    id,
    priority: 1,
    area: "harness",
    title: `feature ${id}`,
    user_visible_behavior: "",
    status: "in_progress",
    sprint: "02",
    owner,
    verification: [],
    evidence: "",
    notes: "",
  };
}

const SPRINT_02 = [feature("F34", "w2-files2"), feature("F50", "w2-model"), feature("F158", "dev-project")];

function opts(o: Partial<EvidenceScopeOptions> = {}): EvidenceScopeOptions {
  return { only: null, owner: null, all: false, ...o };
}

describe("#1025 verify 只对本次任务对象做写操作", () => {
  it("事故现场：dev-project 跑 sprint 全量，别人名下的 F34/F50 不进作用域", () => {
    const { inScope, skipped } = partitionByWriteScope(SPRINT_02, opts({ owner: "dev-project" }));
    expect(inScope.map((f) => f.id)).toEqual(["F158"]);
    expect(skipped).toEqual([
      { id: "F34", owner: "w2-files2" },
      { id: "F50", owner: "w2-model" },
    ]);
  });

  it("没声明 --owner 时只认无主 feature，别人名下的一律跳过", () => {
    const { inScope, skipped } = partitionByWriteScope([...SPRINT_02, feature("F99", null)], opts());
    expect(inScope.map((f) => f.id)).toEqual(["F99"]);
    expect(skipped.map((s) => s.id)).toEqual(["F34", "F50", "F158"]);
  });

  it("--feature 点名的那条就是任务对象（即使它不在本 owner 名下）", () => {
    expect(isInWriteScope(feature("F34", "w2-files2"), opts({ only: "F34", owner: "dev-project" }))).toBe(true);
    expect(isInWriteScope(feature("F50", "w2-model"), opts({ only: "F34", owner: "dev-project" }))).toBe(false);
  });

  it("--all 是唯一能写别人 evidence 的开关", () => {
    const { inScope, skipped } = partitionByWriteScope(SPRINT_02, opts({ owner: "dev-project", all: true }));
    expect(inScope.map((f) => f.id)).toEqual(["F34", "F50", "F158"]);
    expect(skipped).toEqual([]);
  });

  it("跳过必须出声：说清跳了几个、是谁的、以及怎么才能跑全量", () => {
    const { skipped } = partitionByWriteScope(SPRINT_02, opts({ owner: "dev-project" }));
    const note = describeSkipped(skipped, opts({ owner: "dev-project" }));
    expect(note).toContain("已跳过 2 个");
    expect(note).toContain("F34(owner=w2-files2)");
    expect(note).toContain("--all");
    expect(describeSkipped([], opts())).toBeNull();
  });

  it("没声明身份时的跳过提示额外指路 --owner", () => {
    const { skipped } = partitionByWriteScope(SPRINT_02, opts());
    expect(describeSkipped(skipped, opts())).toContain("--owner");
  });

  it("经 --all/--feature 把失败运行写进别人名下时额外告警；写自己名下或通过时不吵", () => {
    const foreign = feature("F34", "w2-files2");
    const mine = feature("F158", "dev-project");
    const scope = opts({ owner: "dev-project", all: true });
    expect(nonOwnerWriteWarning(foreign, scope, false)).toContain("F34");
    expect(nonOwnerWriteWarning(foreign, scope, true)).toBeNull();
    expect(nonOwnerWriteWarning(mine, scope, false)).toBeNull();
    expect(nonOwnerWriteWarning(feature("F99", null), opts(), false)).toBeNull();
  });
});

/**
 * 源级门（同 verify-no-silent-claim.test.ts 的形状）：verify.ts 必须经由本模块
 * 收窄作用域后再落盘证据。谁要恢复「扫到谁就写谁」的旧行为，得先来改这条测试
 * 并在 PR 里解释为什么 #1025 错了。
 */
describe("#1025 verify.ts 接线不得被摘掉", () => {
  const src = readFileSync(join(REPO_ROOT, ".harness", "scripts", "verify.ts"), "utf8");

  it("verify.ts 在进入验证循环前调用 partitionByWriteScope", () => {
    expect(src).toMatch(/partitionByWriteScope\(/);
    expect(src.indexOf("partitionByWriteScope(")).toBeLessThan(src.indexOf("writeFileSync("));
  });

  it("verify.ts 读取 --owner 与 --all", () => {
    expect(src).toMatch(/args\.opts\["owner"\]/);
    expect(src).toMatch(/args\.flags\["all"\]/);
  });
});
