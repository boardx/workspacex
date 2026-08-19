/**
 * `verification.md` **V5**：洋葱依赖方向。design delta `skill-sandbox-execution`，F210 / #1583。
 *
 * `lint-arch-deps` 已经在 `apps/api` 的 `lint` 脚本里跑（机械门控，覆盖全层）。
 * 本文件补的是**针对本 delta 的具体断言**：`interface/` 下没有任何文件直接
 * import `http-skill-sandbox`。
 *
 * ## 为什么值得单独钉一条，而不是"反正 lint-arch-deps 会管"
 *
 * `lint-arch-deps` 是按**层**判定的通用规则。它当然会抓到这条违规，但抓到时给出的
 * 信息是"interface 不该 import infrastructure"，而不是"沙箱端口被 controller
 * 直接接死了"。本条把 delta 自己的不变量写成它自己的名字，回归时一眼能看懂。
 * 与 `ORG_AGENT_MODEL_READER`（#1499）留下的先例同一形态。
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const INTERFACE_ROOT = join(import.meta.dirname, "..", "..", "src", "interface");
const APPLICATION_PORT = join(import.meta.dirname, "..", "..", "src", "application", "skill", "skill-sandbox-port.ts");

async function tsFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFilesUnder(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("V5 洋葱依赖方向", () => {
  it("no file under interface/ imports the concrete HttpSkillSandbox", async () => {
    const files = await tsFilesUnder(INTERFACE_ROOT);
    // 自检：真的扫到了文件。目录看错/为空时这条断言会红，而不是空转全绿
    // （`lint-arch-deps` 自己也栽过"目录不存在就 skipped 并 exit 0"这个坑）。
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/from\s+["'][^"']*http-skill-sandbox/.test(source)) offenders.push(file);
      if (/from\s+["'][^"']*\/infrastructure\//.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the port itself lives in application/, so controllers have something to depend on", async () => {
    const source = await readFile(APPLICATION_PORT, "utf8");
    expect(source).toContain("export const SKILL_SANDBOX_PORT");
    expect(source).toContain("export interface SkillSandboxPort");
    // 端口定义**不得**从 infrastructure 拉类型——那会把依赖倒置反过来。
    expect(source).not.toMatch(/from\s+["'][^"']*\/infrastructure\//);
  });
});
