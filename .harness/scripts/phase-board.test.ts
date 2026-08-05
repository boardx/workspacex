/**
 * 看板自己的钉子 —— 它是每轮 loop 的**起点**，所以「它崩了」比它显示得不好看严重得多。
 *
 * ⚠ 这条测试的存在理由是一次真实崩溃：`dueOf` 在没有承诺时间时不返回 `delta`，
 *   而调用方 `pad(flag, 14)` 会 `for (const ch of s)` ⇒ `s is not iterable`
 *   ⇒ **整块看板从那一行断掉**，后面的 PR 队列与人类阻断项全部消失。
 *   触发条件只是「有人开了一张新 issue」（实测 #552）。
 *
 * ## ⚠ 为什么要塞一个假 `gh` 而不是直接跑
 *
 * 第一版直接跑，**在 CI 里红了，而且红得对**：CI 没有 `gh` 认证 ⇒ 看板拿到
 * 零个 issue ⇒ 那条缺省分支**根本走不到**。也就是说，那一版在 CI 里
 * **无论修没修都会得到同一个结果** —— 一条在真正要守的环境里恒不执行的断言，
 * 正是本仓九次「全绿但空转」的形状。
 *
 * ⇒ 用 PATH 前置一个假 `gh`：既让测试与网络无关，又保证那条分支**一定被走到**。
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const STATE = join(ROOT, ".harness/state/core-loop-commitments.json");
const SCRIPT = join(ROOT, ".harness/scripts/phase-board.mjs");

/** 一张 open issue、一个 open PR —— 足以让每个渲染分支都被走到。 */
const FAKE_GH = `#!/usr/bin/env bash
for a in "$@"; do
  if [ "$a" = "pr" ]; then
    echo '[{"number":1,"title":"假 PR","createdAt":"2026-08-05T00:00:00Z","isDraft":false,"statusCheckRollup":[],"mergeStateStatus":"CLEAN"}]'
    exit 0
  fi
done
case "$*" in
  *--state\\ closed*) echo '[]' ;;
  *) echo '[{"number":9999,"title":"一张刚开的 issue","labels":[{"name":"owner:coord-main"}]}]' ;;
esac
`;

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

function run(commitments: Record<string, unknown>): string {
  dir = mkdtempSync(join(tmpdir(), "board-"));
  const gh = join(dir, "gh");
  writeFileSync(gh, FAKE_GH);
  chmodSync(gh, 0o755);

  const original = readFileSync(STATE, "utf8");
  const cfg = JSON.parse(original);
  cfg.commitments = commitments;
  try {
    writeFileSync(STATE, JSON.stringify(cfg));
    return execFileSync("node", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BOARD_NOW: "2026-08-05T12:00:00+08:00" },
    });
  } finally {
    writeFileSync(STATE, original);
  }
}

function runWithBlockers(blockers: unknown[]): string {
  dir = mkdtempSync(join(tmpdir(), "board-"));
  const gh = join(dir, "gh");
  writeFileSync(gh, FAKE_GH);
  chmodSync(gh, 0o755);
  const original = readFileSync(STATE, "utf8");
  const cfg = JSON.parse(original);
  cfg.human_blockers = blockers;
  try {
    writeFileSync(STATE, JSON.stringify(cfg));
    return execFileSync("node", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BOARD_NOW: "2026-08-05T12:00:00+08:00" },
    });
  } finally {
    writeFileSync(STATE, original);
  }
}

describe("阶段看板", () => {
  it("承诺表里没有那张 issue 时仍然跑完整块板，不半途崩掉", () => {
    const out = run({});
    // ① 那条缺省分支**确实被走到了** —— 否则这条测试与修没修无关（CI 里就这么空转过）。
    expect(out).toContain("未承诺");
    // ② 反空转：必须真的跑到**最后一段**。只断「没抛异常」会被一个提前 return 的实现满足。
    expect(out).toContain("PR 队列");
    expect(out).toContain("必须由你（人类）完成");
  });

  it("正样本：有承诺时间时渲染倒计时，证明上面那条不是因为整块板都没渲染", () => {
    const out = run({ "9999": { due: "2026-08-05T17:00:00+08:00", step: "—", note: "有承诺" } });
    expect(out).toContain("还剩");
    expect(out).not.toContain("未承诺");
  });
});

describe("人类阻断项：清单里有 ≠ 现在还成立", () => {
  /**
   * 由 coord-chat-e2e 2026-08-05 报出：`human_blockers` 原本**没有任何字段**
   * 能表达「这条已经不成立了」，于是看板会永远打印同一个瓶颈。
   *
   * ⚠ 它指出这正是本看板自己犯了它要防的错 —— 进度板那一栏专门标着
   *   「数据源不是谁的说法」，而这一栏恰恰是一份只能新增、不能解除的手写清单。
   *
   * 两条不变量：**已解除的不再算瓶颈**，且**未解除的照旧算**（否则等于把这栏删了）。
   */
  const BLOCKER = {
    id: "x", title: "假阻断", why: "反证用", cmd: "true", blocks: "反证用",
  } as const;

  it("已解除的阻断项不再进入「当前瓶颈」，但仍以一行摘要保留可追溯", () => {
    const out = runWithBlockers([{ ...BLOCKER, resolved_at: "2026-08-05T10:00:00+08:00",
      resolved_by: "反证", evidence: "反证" }]);
    expect(out).not.toContain("🔻 当前瓶颈   人类阻断项");
    expect(out).toContain("已解除");     // 保留记录，不是删掉
    expect(out).toContain("假阻断");
  });

  it("反空转正样本：**未**解除的照旧算作当前瓶颈", () => {
    const out = runWithBlockers([BLOCKER]);
    expect(out).toContain("🔻 当前瓶颈   人类阻断项 1 条");
  });
});
