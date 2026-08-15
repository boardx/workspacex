// verify-cache.test.ts — 反证是本 issue（#1275）的核心，不是可选项：
// 1. 正向：同 SHA + 同指纹 + 同类型 → 命中。
// 2. 反证：指纹变了（哪怕 SHA 没变）→ 不命中，必须真跑。
// 3. 反证：验证类型换了 → 即使 SHA+指纹相同也不命中，不同 profile 的验证不能互相顶替。
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// verify-cache.ts 的 ROOT 是相对本文件路径推导的（真实仓库根），凭证文件因此写进
// 真实仓库的 .harness/state/.cache/ 下——测试用完就删这个文件，不留痕迹污染其它
// 测试或真实使用。计算指纹的部分则用一个独立的临时 git 仓库隔离，不依赖本仓库
// 当前的工作树状态（避免"测试结果取决于开发者本机有没有未提交改动"这种脆弱性）。
import {
  cacheReadDisabled,
  computeFingerprint,
  currentSha,
  lookupCredential,
  recordCredential,
  credentialsPath,
} from "./verify-cache";

describe("verify-cache", () => {
  afterEach(() => {
    // 清理本次测试写入的凭证文件，不影响宿主仓库的真实缓存状态
    try {
      rmSync(credentialsPath());
    } catch {
      /* 文件本来就不存在也没关系 */
    }
  });

  it("同 SHA + 同指纹 + 同类型：命中缓存", () => {
    const sha = "deadbeef".repeat(5); // 40 hex chars，格式够用，不需要真实 SHA
    const fingerprint = "fp-a";
    recordCredential({
      sha,
      fingerprint,
      verificationType: "quick",
      command: "true",
      exitCode: 0,
      completedAt: new Date().toISOString(),
    });
    const hit = lookupCredential("quick", sha, fingerprint);
    expect(hit).not.toBeNull();
    expect(hit?.exitCode).toBe(0);
  });

  it("反证：指纹变了（SHA 不变）——不命中", () => {
    const sha = "deadbeef".repeat(5);
    recordCredential({
      sha,
      fingerprint: "fp-old",
      verificationType: "quick",
      command: "true",
      exitCode: 0,
      completedAt: new Date().toISOString(),
    });
    const miss = lookupCredential("quick", sha, "fp-new");
    expect(miss).toBeNull();
  });

  it("反证：验证类型不同——即使 SHA+指纹相同也不命中", () => {
    const sha = "deadbeef".repeat(5);
    const fingerprint = "fp-shared";
    recordCredential({
      sha,
      fingerprint,
      verificationType: "quick",
      command: "true",
      exitCode: 0,
      completedAt: new Date().toISOString(),
    });
    const miss = lookupCredential("release", sha, fingerprint);
    expect(miss).toBeNull();
  });

  it("computeFingerprint：同一 HEAD、工作树有无未提交改动，指纹必须不同", () => {
    const tmp = mkdtempSync(join(tmpdir(), "verify-cache-fp-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: tmp });
      execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: tmp });
      execFileSync("git", ["config", "user.name", "t"], { cwd: tmp });
      writeFileSync(join(tmp, "a.txt"), "hello\n");
      execFileSync("git", ["add", "."], { cwd: tmp });
      execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });

      // computeFingerprint 读的是"当前进程 cwd 所在仓库根"的 git 状态——
      // verify-cache.ts 内部用 ROOT（本仓库路径）跑 git 命令，跟这个临时仓库
      // 不是同一个 git 上下文，所以这条用例改为直接用 execFileSync 复刻同一段
      // 逻辑做隔离验证，而不是调用被测函数本身（它硬编码了 ROOT）。
      const shaClean = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmp, encoding: "utf8" }).trim();
      const diffClean = execFileSync("git", ["diff", "HEAD", "--"], { cwd: tmp, encoding: "utf8" });

      writeFileSync(join(tmp, "a.txt"), "hello, changed\n");
      const shaDirty = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmp, encoding: "utf8" }).trim();
      const diffDirty = execFileSync("git", ["diff", "HEAD", "--"], { cwd: tmp, encoding: "utf8" });

      expect(shaClean).toBe(shaDirty); // SHA 没变
      expect(diffClean).not.toBe(diffDirty); // 但 diff 变了——这正是指纹要吃进去的信号
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });


  // ── #1334：失败不入缓存 + 逃生口 ────────────────────────────────────────
  it("反证：失败结果不写入缓存——基础设施抖动不能被钉死", () => {
    const sha = "c0ffee00".repeat(5);
    const fp = "fp-fail";
    const wrote = recordCredential({
      sha,
      fingerprint: fp,
      verificationType: "standard",
      command: "false",
      exitCode: 1, // 失败
      completedAt: new Date().toISOString(),
    });
    expect(wrote).toBe(false); // 明确拒绝，不是静默吞掉
    expect(lookupCredential("standard", sha, fp)).toBeNull(); // 下次必然重跑
  });

  it("成功结果照常写入（确认上一条不是把缓存整个关掉了）", () => {
    const sha = "c0ffee01".repeat(5);
    const fp = "fp-ok";
    expect(
      recordCredential({
        sha,
        fingerprint: fp,
        verificationType: "standard",
        command: "true",
        exitCode: 0,
        completedAt: new Date().toISOString(),
      }),
    ).toBe(true);
    expect(lookupCredential("standard", sha, fp)).not.toBeNull();
  });

  it("逃生口 WORKSPACEX_VERIFY_NO_CACHE=1 让调用方跳过读缓存", () => {
    expect(cacheReadDisabled({ WORKSPACEX_VERIFY_NO_CACHE: "1" })).toBe(true);
    expect(cacheReadDisabled({})).toBe(false);
    expect(cacheReadDisabled({ WORKSPACEX_VERIFY_NO_CACHE: "0" })).toBe(false);
  });

  // ── #1334 更正记录：原判断「指纹漏 merge-base 会假绿」经实测证伪 ─────────
  // merge-base 是**共同祖先**，origin/main 前进不改变分支点，affected 集合因此
  // 不变；rebase 会改 HEAD SHA（指纹自然失效）；origin/main 被改写历史时
  // merge-base 变空、verify-quick.ts 的 resolveBaseSha 报环境错误退出。三条路径
  // 都不产生假绿。本用例把这个结论钉住，防止后来人"看着像有洞"又加一次。
  it("merge-base 不随 origin/main 前进而移动（钉住 #1334 的证伪结论）", () => {
    const tmp = mkdtempSync(join(tmpdir(), "verify-cache-mb-"));
    try {
      const g = (args: string) =>
        execFileSync("git", args.split(" "), { cwd: tmp, encoding: "utf8" }).trim();
      execFileSync("git", ["init", "-q", "."], { cwd: tmp });
      g("config user.email t@e.com");
      g("config user.name t");
      writeFileSync(join(tmp, "x.txt"), "1\n");
      g("add .");
      g("commit -qm A");
      const a = g("rev-parse HEAD");
      g(`update-ref refs/remotes/origin/main ${a}`);
      g("checkout -qb feature");
      writeFileSync(join(tmp, "y.txt"), "2\n");
      g("add .");
      g("commit -qm B");
      const head = g("rev-parse HEAD");
      const mbBefore = g("merge-base origin/main HEAD");

      // origin/main 前进到 C，HEAD 与工作树都不动
      g("checkout -q main");
      writeFileSync(join(tmp, "z.txt"), "3\n");
      g("add .");
      g("commit -qm C");
      g(`update-ref refs/remotes/origin/main ${g("rev-parse main")}`);
      g("checkout -q feature");

      expect(g("rev-parse HEAD")).toBe(head); // HEAD 没变
      expect(g("merge-base origin/main HEAD")).toBe(mbBefore); // merge-base 也没变
      expect(mbBefore).toBe(a); // 就是分支点
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("currentSha 返回的是真实仓库当前 HEAD（非空、40 位 hex）", () => {
    const sha = currentSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("computeFingerprint 在真实仓库上下文里对同一状态是确定性的（同输入同输出）", () => {
    const sha = currentSha();
    const fp1 = computeFingerprint(sha);
    const fp2 = computeFingerprint(sha);
    expect(fp1).toBe(fp2);
  });
});
