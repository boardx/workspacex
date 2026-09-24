/**
 * 部署时自动清除已下线投后 agent（#4012，2026-09-24 人类决定）的接线检查。
 * 删代码不删数据：不接进部署，库里那几行就永远留着。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const deploy = readFileSync(join(ROOT, ".harness/scripts/vm/deploy.sh"), "utf8");
const line = deploy.split("\n").find((l) => l.includes("scripts/purge-postinvest-agents.ts")) ?? "";

describe("deploy.sh 清除已下线投后 agent", () => {
  it("清除脚本存在，且部署里真的调用它（带 --apply）", () => {
    expect(existsSync(join(ROOT, "apps/api/scripts/purge-postinvest-agents.ts"))).toBe(true);
    expect(line).toMatch(/--apply/);
  });

  it("不带 --purge-threads：用户的对话是用户的数据，部署不许删", () => {
    expect(line).not.toBe("");
    expect(line).not.toMatch(/--purge-threads/);
  });
});
