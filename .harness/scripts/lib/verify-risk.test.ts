// verify-risk.test.ts — #1332 的反证套件。
//
// ⚠ 本文件刻意**不**用手工构造的 feature 对象喂分类器——那正是原实现（#1274）
// 漏掉这个洞的原因：当时 7 条"真实场景反证"全绿，但 fixture 里的 verification
// 命令是照着实现反推编出来的（编了一条含 migration 路径的命令），真实 feature
// 根本不长那样。测试测的是"实现得对不对"，不是"被喂的输入对不对"。
//
// 所以这里的核心用例建**真实临时 git 仓库**，真的改文件、真的 commit，让
// collectChangedFiles 走真实 git 命令拿改动清单——端到端，不是函数级。
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  classifyRisk,
  collectChangedFiles,
  globToRegExp,
  matchesAnyPattern,
  resolveVerifyProfile,
} from "./verify-risk";
import type { VerificationConfig } from "./config";

const cfg: VerificationConfig = {
  shell: "bash",
  fail_fast: true,
  default_profile: "standard",
  profiles: {
    small: "echo QUICK",
    standard: "echo QUICK",
    high_risk: "echo RELEASE",
  },
  high_risk_paths: [
    "apps/api/migrations/**",
    "**/migrations/**",
    "**/*.sql",
    "apps/api/src/*/auth/**",
    "apps/api/src/*/identity/**",
    "packages/contracts/**",
    "packages/coord-*/**",
  ],
};

/** 建一个带 origin/main 引用的临时仓库，返回 repo 路径与在其中跑 git 的助手。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "verify-risk-"));
  const g = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "."], { cwd: dir });
  g(["config", "user.email", "t@e.com"]);
  g(["config", "user.name", "t"]);
  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  write("README.md", "base\n");
  g(["add", "."]);
  g(["commit", "-qm", "base"]);
  g(["update-ref", "refs/remotes/origin/main", g(["rev-parse", "HEAD"])]);
  g(["checkout", "-qb", "feature"]);
  return { dir, g, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("verify-risk：判据基于真实改动文件（#1332）", () => {
  it("端到端：真的改一个 migration 文件 → high_risk（这是 #1274 漏掉的场景）", () => {
    const r = makeRepo();
    try {
      r.write("apps/api/migrations/20260815_add_col.sql", "ALTER TABLE t ADD COLUMN c int;\n");
      r.g(["add", "."]);
      r.g(["commit", "-qm", "migration"]);
      const decision = classifyRisk(collectChangedFiles(r.dir), cfg);
      expect(decision.level).toBe("high_risk");
      expect(decision.matched.map((m) => m.path)).toContain(
        "apps/api/migrations/20260815_add_col.sql",
      );
    } finally {
      r.cleanup();
    }
  });

  it("端到端：**未提交**的新增 migration 也要算——新增文件正是最典型的场景", () => {
    const r = makeRepo();
    try {
      r.write("apps/api/migrations/20260815_uncommitted.sql", "-- wip\n"); // 未 add
      const decision = classifyRisk(collectChangedFiles(r.dir), cfg);
      expect(decision.level).toBe("high_risk");
    } finally {
      r.cleanup();
    }
  });

  it("端到端：改跨束契约 → high_risk", () => {
    const r = makeRepo();
    try {
      r.write("packages/contracts/src/chat.ts", "export type X = 1;\n");
      r.g(["add", "."]);
      r.g(["commit", "-qm", "contract"]);
      expect(classifyRisk(collectChangedFiles(r.dir), cfg).level).toBe("high_risk");
    } finally {
      r.cleanup();
    }
  });

  it("端到端：改鉴权源码 → high_risk", () => {
    const r = makeRepo();
    try {
      r.write("apps/api/src/domain/auth/policy.ts", "export const x = 1;\n");
      r.g(["add", "."]);
      r.g(["commit", "-qm", "auth"]);
      expect(classifyRisk(collectChangedFiles(r.dir), cfg).level).toBe("high_risk");
    } finally {
      r.cleanup();
    }
  });

  it("端到端反证：只改文档 → standard，不误判成 high_risk", () => {
    const r = makeRepo();
    try {
      r.write("docs/notes.md", "hello\n");
      r.g(["add", "."]);
      r.g(["commit", "-qm", "docs"]);
      const decision = classifyRisk(collectChangedFiles(r.dir), cfg);
      expect(decision.level).toBe("standard");
      expect(decision.matched).toHaveLength(0);
      expect(resolveVerifyProfile(collectChangedFiles(r.dir), cfg).cmd).toBe("echo QUICK");
    } finally {
      r.cleanup();
    }
  });

  it("端到端反证：改普通前端源码 → standard（不是所有代码改动都高风险）", () => {
    const r = makeRepo();
    try {
      r.write("apps/web/app/chat/page.tsx", "export default () => null;\n");
      r.g(["add", "."]);
      r.g(["commit", "-qm", "web"]);
      expect(classifyRisk(collectChangedFiles(r.dir), cfg).level).toBe("standard");
    } finally {
      r.cleanup();
    }
  });

  it("fail-closed：拿不到 merge-base（无 origin/main）→ high_risk，且带原因", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-risk-nogit-"));
    try {
      execFileSync("git", ["init", "-q", "."], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
      writeFileSync(join(dir, "a.txt"), "1\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "a"], { cwd: dir });
      const changed = collectChangedFiles(dir); // 没有 origin/main 引用
      expect(changed.paths).toBeNull();
      const decision = classifyRisk(changed, cfg);
      expect(decision.level).toBe("high_risk");
      expect(decision.failClosedReason).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── glob 语义（防止退回"子串匹配"那类隐式行为）────────────────────────
  it("反证：不是子串匹配——`auth` 相关 pattern 不会误伤 requirement-author", () => {
    expect(matchesAnyPattern("docs/requirement-author.md", cfg.high_risk_paths)).toBe(false);
    expect(matchesAnyPattern(".agents/skills/requirement-author/SKILL.md", cfg.high_risk_paths)).toBe(
      false,
    );
  });

  it("glob：`*` 不跨 `/`，`**` 跨", () => {
    expect(globToRegExp("a/*/c").test("a/b/c")).toBe(true);
    expect(globToRegExp("a/*/c").test("a/b/x/c")).toBe(false);
    expect(globToRegExp("a/**/c").test("a/b/x/c")).toBe(true);
  });

  it("glob：点号按字面转义，不当正则元字符", () => {
    expect(globToRegExp("**/*.sql").test("x/y.sql")).toBe(true);
    expect(globToRegExp("**/*.sql").test("x/ysql")).toBe(false); // `.` 不是任意字符
  });

  it("反证：profiles 缺档必须报错，不能返回 undefined 静默通过", () => {
    const bad: VerificationConfig = { ...cfg, profiles: { small: "x", standard: "y" } };
    const r = makeRepo();
    try {
      r.write("apps/api/migrations/x.sql", "-- x\n");
      expect(() => resolveVerifyProfile(collectChangedFiles(r.dir), bad)).toThrow(/high_risk/);
    } finally {
      r.cleanup();
    }
  });

  it("反证：default_profile 非法值必须报错，不能悄悄退化", () => {
    const bad: VerificationConfig = { ...cfg, default_profile: "nope" };
    const r = makeRepo();
    try {
      r.write("docs/x.md", "x\n");
      expect(() => classifyRisk(collectChangedFiles(r.dir), bad)).toThrow(/default_profile/);
    } finally {
      r.cleanup();
    }
  });
});
