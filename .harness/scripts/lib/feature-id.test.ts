// feature-id.test.ts —— #1094 的反证。
//
// 纯函数部分跟随 adr-id.test.ts / template-id.test.ts 的做法（喂 id 列表，不碰盘）；
// **竞态部分必须真并发**：这条 issue 的核心断言是「流程约定治不了竞态」，用串行调用
// 跑出来的绿是假绿。所以下面起真的多进程，用一个屏障文件让它们同时开跑，并且——
// 关键——**同一个 fixture 先用快照式分配跑一遍，断言它真的撞号**。
// 没有那条对照，原子路径的绿说明不了任何事（可能只是并发根本没发生）。
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allocateFeatureId,
  duplicateFeatureIds,
  featureIdNumber,
  featureIdLockDir,
  isPlaceholderFeatureId,
  nextFeatureId,
} from "./feature-id";
import type { Feature, FeatureList } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function feature(id: string, over: Partial<Feature> = {}): Feature {
  return {
    id,
    priority: 1,
    area: "harness",
    title: `feature ${id}`,
    user_visible_behavior: "…",
    status: "not_started",
    sprint: null,
    owner: null,
    verification: ["pnpm exec tsx .harness/scripts/cli.ts doctor"],
    evidence: "",
    notes: "",
    ...over,
  };
}

/** 造一份只有清单文件的临时 phase 目录（不需要真的 phases/ 结构：分配器按路径工作）。 */
function makeFixture(features: Feature[], archived: Feature[] = []): { listPath: string; archivePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "feature-id-"));
  tempDirs.push(dir);
  const listPath = join(dir, "feature_list.json");
  const archivePath = join(dir, "feature_list.archive.json");
  writeFileSync(listPath, JSON.stringify({ phase: "99", features } satisfies FeatureList, null, 2) + "\n", "utf8");
  if (archived.length > 0) {
    writeFileSync(archivePath, JSON.stringify({ phase: "99", features: archived }, null, 2) + "\n", "utf8");
  }
  return { listPath, archivePath };
}

function readIds(listPath: string): string[] {
  return (JSON.parse(readFileSync(listPath, "utf8")) as FeatureList).features.map((f) => f.id);
}

describe("featureIdNumber / isPlaceholderFeatureId", () => {
  it("拆出正式编号的数字部分（位数不固定：F01 与 F1681 都在用）", () => {
    expect(featureIdNumber("F01")).toBe(1);
    expect(featureIdNumber("F1681")).toBe(1681);
  });

  it.each(["F-TBD-room-invite", "f01", "F", "F01a", "ADR-020", ""])(
    "🔴 非正式编号 %s → null，不抛异常",
    (bad) => {
      expect(featureIdNumber(bad)).toBeNull();
    },
  );

  it("占位 id 只认 F-TBD-<slug> 这一种形态", () => {
    expect(isPlaceholderFeatureId("F-TBD-room-invite")).toBe(true);
    expect(isPlaceholderFeatureId("F-TBD-a1")).toBe(true);
    // 🔴 光秃秃的 F-TBD 不合格：同一批里会有多个占位条目，没有 slug 就分不开
    expect(isPlaceholderFeatureId("F-TBD")).toBe(false);
    expect(isPlaceholderFeatureId("F-TBD-")).toBe(false);
    expect(isPlaceholderFeatureId("F172")).toBe(false);
  });
});

describe("nextFeatureId", () => {
  it("空清单 → F01；已有 F01/F02 → F03", () => {
    expect(nextFeatureId([])).toBe("F01");
    expect(nextFeatureId(["F01", "F02"])).toBe("F03");
  });

  it("🔴 占位 id 不参与求 max（它没有号）", () => {
    expect(nextFeatureId(["F07", "F-TBD-x", "F-TBD-y"])).toBe("F08");
  });

  it("中间空洞不回填：F01 + F03 → F04，不是 F02", () => {
    expect(nextFeatureId(["F01", "F03"])).toBe("F04");
  });

  it("三位以上不被零填充截断（F1681 → F1682）", () => {
    expect(nextFeatureId(["F1681"])).toBe("F1682");
  });
});

describe("duplicateFeatureIds", () => {
  it("没有重复 → 空数组", () => {
    expect(duplicateFeatureIds(["F01", "F02"])).toEqual([]);
  });

  it("🔴 点名全部重复项，升序去重", () => {
    expect(duplicateFeatureIds(["F02", "F01", "F02", "F01", "F02"])).toEqual(["F01", "F02"]);
  });
});

describe("allocateFeatureId —— 单进程语义", () => {
  it("回填占位条目，保留其余字段；号 = live ∪ archive 的 max + 1", () => {
    const { listPath, archivePath } = makeFixture(
      [feature("F03"), feature("F-TBD-room-invite", { title: "邀请成员进房间" })],
      [feature("F07", { status: "passing" })],
    );
    const r = allocateFeatureId({ listPath, archivePath, placeholderId: "F-TBD-room-invite" });
    // 🔴 归档里的 F07 同样占着号：漏并归档就会把 F07 再发一次
    expect(r).toEqual({ id: "F08", attempts: 1, renamedReferences: [] });
    const fl = JSON.parse(readFileSync(listPath, "utf8")) as FeatureList;
    expect(fl.features.map((f) => f.id)).toEqual(["F03", "F08"]);
    expect(fl.features[1]!.title).toBe("邀请成员进房间");
  });

  it("🔴 拒绝对一个已经发出去的编号重新取号——那等于替别人改号", () => {
    const { listPath } = makeFixture([feature("F03")]);
    expect(() => allocateFeatureId({ listPath, placeholderId: "F03" })).toThrow(/不是占位 id/);
  });

  it("🔴 占位 id 不在清单里 → 报错点名，不静默追加一条", () => {
    const { listPath } = makeFixture([feature("F03")]);
    expect(() => allocateFeatureId({ listPath, placeholderId: "F-TBD-nope" })).toThrow(/没有 id=F-TBD-nope/);
    expect(readIds(listPath)).toEqual(["F03"]);
  });

  it("同一份清单里指向占位 id 的 depends_on 跟着改号（否则依赖边悄悄断掉）", () => {
    const { listPath } = makeFixture([
      feature("F03"),
      feature("F-TBD-base"),
      feature("F-TBD-dependent", { depends_on: ["F-TBD-base", "p9:F02"] }),
    ]);
    const r = allocateFeatureId({ listPath, placeholderId: "F-TBD-base" });
    expect(r.id).toBe("F04");
    const fl = JSON.parse(readFileSync(listPath, "utf8")) as FeatureList;
    // 🔴 改的只有那一条引用；跨阶段依赖与别的占位 id 一字未动
    expect(fl.features[2]!.depends_on).toEqual(["F04", "p9:F02"]);
    expect(r.renamedReferences).toEqual([listPath]);
  });

  it("🔴 已签契约束的 covers: 跟着改号——不改的话这条 feature 一取号就「不属于任何契约束」", () => {
    const { listPath } = makeFixture([feature("F03"), feature("F-TBD-room"), feature("F-TBD-room-invite")]);
    const signoff = join(dirname(listPath), "design-signoff.md");
    writeFileSync(
      signoff,
      [
        "---",
        "status: confirmed",
        "confirmed_by: 人类工程师",
        "confirmed_at: 2026-08-12",
        "covers: [F03, F-TBD-room-invite]",
        "---",
        "",
        "本束覆盖 F-TBD-room-invite 的邀请链路。",
        "",
      ].join("\n"),
      "utf8",
    );
    const r = allocateFeatureId({
      listPath,
      placeholderId: "F-TBD-room-invite",
      referenceFiles: [signoff],
    });
    const text = readFileSync(signoff, "utf8");
    expect(r.id).toBe("F04");
    expect(text).toContain("covers: [F03, F04]");
    expect(text).toContain("本束覆盖 F04 的邀请链路。");
    // 🔴 签核本身（人的动作）一字不动：只换编号指针
    expect(text).toContain("status: confirmed");
    expect(text).toContain("confirmed_by: 人类工程师");
    // 🔴 前缀相同的另一个占位 id 不能被误伤
    expect(readIds(listPath)).toContain("F-TBD-room");
    expect(r.renamedReferences).toEqual([signoff]);
  });

  it("命令结束后不留锁目录（留着会让下一个 claim 空等到超时）", () => {
    const { listPath } = makeFixture([feature("F-TBD-x")]);
    allocateFeatureId({ listPath, placeholderId: "F-TBD-x" });
    expect(existsSync(featureIdLockDir(listPath))).toBe(false);
  });

  it("🔴 有人在「锁内读」与「写回」之间占走了这个号 → 写回核对发现重号，回滚重试，最终拿到没被占的号", () => {
    // onBeforeWrite 模拟一个**不持锁**的写入方（手改文件 / 旧版本脚本）：
    // 它抢在我们写回之前把 F04 写进了清单。没有「写回后再读一次核对 + 重试」，
    // 盘上就会留下两条 F04——正是 #1094 的失效形态。
    const { listPath } = makeFixture([feature("F03"), feature("F-TBD-x")]);
    const r = allocateFeatureId({
      listPath,
      placeholderId: "F-TBD-x",
      onBeforeWrite: (attempt) => {
        if (attempt !== 1) return;
        const fl = JSON.parse(readFileSync(listPath, "utf8")) as FeatureList;
        fl.features.splice(1, 0, feature("F04", { title: "别人的 feature" }));
        writeFileSync(listPath, JSON.stringify(fl, null, 2) + "\n", "utf8");
      },
    });
    expect(r.attempts).toBe(2);
    expect(r.id).toBe("F05");
    const ids = readIds(listPath);
    expect(duplicateFeatureIds(ids)).toEqual([]);
    expect(ids).toEqual(["F03", "F04", "F05"]);
    // 别人的那条一字未动
    const fl = JSON.parse(readFileSync(listPath, "utf8")) as FeatureList;
    expect(fl.features.find((f) => f.id === "F04")!.title).toBe("别人的 feature");
  });
});

// ── 真并发：N 个进程同时取号 ────────────────────────────────────────────────
//
// 子进程两种模式：
//   atomic   —— 走 allocateFeatureId（本 PR 的修法：分配点 = 写入点）。
//   snapshot —— 修复前的做法：**先读到 max 挑好号，过一会儿再写**
//               （"开工时读清单挑 F165，几小时后提交"的压缩版）。
//               它的写入路径是安全的（自带一把粗糙的互斥锁，不会丢更新），
//               所以它一定会撞号这件事**只可能来自分配点与写入点分离**——
//               这正是 issue #1094 的论点：「流程约定治不了竞态」。
//
// 屏障：每个子进程读完/就位后建一个 ready 文件再阻塞等 go，父进程等齐了才放 go。
// 用屏障而不是 sleep：结果不随机器快慢漂移。
const CHILD_SCRIPT = `
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { allocateFeatureId, nextFeatureId } from ${JSON.stringify(join(HERE, "feature-id.ts"))};

const [mode, listPath, placeholderId, readyFile, goFile] = process.argv.slice(2);
const spin = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitForGo = () => { mkdirSync(readyFile); while (!existsSync(goFile)) spin(5); };

if (mode === "atomic") {
  waitForGo();
  // onBeforeWrite 在这里只做一件事：把「读」和「写」之间的窗口撑开 200ms。
  // 不撑开的话，临界区短到几个进程可能恰好不重叠，测试会变成一条撞大运的绿线
  // （实测：把锁和 CAS 都拿掉，窄窗口下它照样全绿 —— 那种绿证明不了任何事）。
  // 200ms 是「一次 GC / 一个大文件 / 一块慢盘」的量级，不是人为的病态输入。
  const r = allocateFeatureId({
    listPath, placeholderId, lockTimeoutMs: 60000, maxAttempts: 50,
    onBeforeWrite: () => spin(200),
  });
  process.stdout.write(r.id);
} else {
  // ① 分配：读到的 max + 1（这一步发生在屏障之前 = "开工时"）
  const before = JSON.parse(readFileSync(listPath, "utf8"));
  const id = nextFeatureId(before.features.map((f) => f.id));
  waitForGo();
  // ② 写入：几小时后才发生。写本身是安全的（粗糙互斥，不丢更新）——
  //    撞号与写入路径无关，纯粹因为号是在 ① 挑的。
  const crude = listPath + ".crude-lock";
  for (;;) {
    try { mkdirSync(crude); break; } catch { spin(5); }
  }
  try {
    const fl = JSON.parse(readFileSync(listPath, "utf8"));
    fl.features.find((f) => f.id === placeholderId).id = id;
    writeFileSync(listPath, JSON.stringify(fl, null, 2) + "\\n", "utf8");
  } finally {
    rmSync(crude, { recursive: true, force: true });
  }
  process.stdout.write(id);
}
`;

/** 这两条要起 4 个 tsx 子进程，远超 vitest 默认的 5s。CI 跑的是
 *  `vitest run --dir .harness`（不带 .harness/vitest.config.ts 的 60s 预算），
 *  所以超时必须写在测试自己身上，不能指望配置。 */
const CONCURRENCY_TEST_TIMEOUT_MS = 30_000;

interface RaceResult {
  listPath: string;
  results: string[];
}

async function runRace(mode: "atomic" | "snapshot", count: number): Promise<RaceResult> {
  const scriptDir = mkdtempSync(join(tmpdir(), "feature-id-child-"));
  tempDirs.push(scriptDir);
  const script = join(scriptDir, "child.ts");
  writeFileSync(script, CHILD_SCRIPT, "utf8");
  const goFile = join(scriptDir, "go");

  const placeholders = Array.from({ length: count }, (_, i) => `F-TBD-p${i}`);
  const { listPath } = makeFixture([feature("F03"), ...placeholders.map((p) => feature(p))]);

  const children = placeholders.map(
    (p, i) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          TSX,
          [script, mode, listPath, p, join(scriptDir, `ready-${i}`), goFile],
          { cwd: REPO_ROOT },
          (err, stdout, stderr) => (err ? reject(new Error(`${p}: ${err.message}\n${stderr}`)) : resolve(stdout.trim())),
        );
      }),
  );

  // 等所有子进程就位（tsx 冷启动约 0.4s），再放屏障。
  const deadline = Date.now() + 20_000;
  while (placeholders.some((_, i) => !existsSync(join(scriptDir, `ready-${i}`)))) {
    if (Date.now() > deadline) throw new Error("子进程未在 20s 内全部就位");
    await new Promise((r) => setTimeout(r, 20));
  }
  mkdirSync(goFile);

  return { listPath, results: await Promise.all(children) };
}

describe("allocateFeatureId —— 真并发（#1094 的核心断言）", () => {
  it("🔴 对照组：快照式分配（先挑号、后写盘）在同样的并发下必然撞号", async () => {
    const n = 4;
    const { listPath, results } = await runRace("snapshot", n);
    // 4 个进程都读到 max=F03 ⇒ 全挑 F04。每个人本地看起来都对，撞了也没人报错——
    // 这就是 2026-08-12 一天内连撞两次的机制。
    expect(new Set(results).size).toBe(1);
    expect(duplicateFeatureIds(readIds(listPath))).toEqual(["F04"]);
  }, CONCURRENCY_TEST_TIMEOUT_MS);

  it("原子取号：同样的并发下 N 个进程拿到 N 个互不相同的号，盘上零重复", async () => {
    const n = 4;
    const { listPath, results } = await runRace("atomic", n);
    expect(new Set(results).size).toBe(n);
    expect([...results].sort()).toEqual(["F04", "F05", "F06", "F07"]);
    const ids = readIds(listPath);
    expect(duplicateFeatureIds(ids)).toEqual([]);
    // 占位 id 一个不剩（没人被别人的整份写覆盖掉）
    expect(ids.filter((id) => isPlaceholderFeatureId(id))).toEqual([]);
    expect([...ids].sort()).toEqual(["F03", "F04", "F05", "F06", "F07"]);
  }, CONCURRENCY_TEST_TIMEOUT_MS);
});
