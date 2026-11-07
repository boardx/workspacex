/**
 * 这条门自己的门：**有脚本还不够，得真的被跑到**。
 *
 * 本仓 AGENTS.md：「没有脚本的规范条目视为未落地」。同理，写了脚本却没接进
 * `verify:harness:raw`，它对 CI 就不存在——那正是这条门要挡的那类"规范有、门控没有"。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

describe("lint-user-facing-error-text", () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["lint:user-facing-error-text"]).toContain("lint-user-facing-error-text.mjs");
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:user-facing-error-text");
  });

  it("当前代码库是干净的（退出码 0）", () => {
    const out = execFileSync("node", [join(ROOT, ".harness/scripts/lint-user-facing-error-text.mjs")], {
      encoding: "utf8",
    });
    expect(out).toContain("没有内部错误码上屏");
  });

  it.each([
    { target: "apps/web/components/error-text-regression.tsx", diagnostic: "内部错误码上屏了" },
    { target: "apps/web/components/admin/member-quota-tab.tsx", diagnostic: "1 处（基线 0）——不许再长" },
  ])("拒绝临时仓库中 $target 的原始异常文案", ({ target, diagnostic }) => {
    const scratch = mkdtempSync(join(tmpdir(), "user-facing-error-text-"));
    try {
      const scanner = ".harness/scripts/lint-user-facing-error-text.mjs";
      mkdirSync(join(scratch, ".harness/scripts"), { recursive: true });
      cpSync(join(ROOT, scanner), join(scratch, scanner));
      for (const root of ["apps/web/components", "apps/web/app"]) {
        mkdirSync(join(scratch, root), { recursive: true });
        cpSync(join(ROOT, root), join(scratch, root), { recursive: true });
      }
      // 先证明完整副本没有无关基线漂移，再只注入这一处反例。
      expect(execFileSync("node", [join(scratch, scanner)], { encoding: "utf8" }))
        .toContain("没有内部错误码上屏");
      appendFileSync(join(scratch, target), "\nfunction rawFailure(err: unknown) { return String(err); }\n");
      const result = spawnSync("node", [join(scratch, scanner)], { encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(target);
      expect(result.stderr).toContain(diagnostic);
      expect(result.stderr).not.toContain("修好了，请把基线改成");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
