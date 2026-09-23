/**
 * 这条门自己的门：**有脚本还不够，得真的被跑到**。
 *
 * 本仓 AGENTS.md：「没有脚本的规范条目视为未落地」。同理，写了脚本却没接进
 * `verify:harness:raw`，它对 CI 就不存在——那正是这条门要挡的那类"规范有、门控没有"。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
});
