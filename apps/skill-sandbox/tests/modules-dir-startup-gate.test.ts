/**
 * 沙箱**不许在缺预装依赖的情况下悄悄起来**（2026-09-25 真实模型十任务矩阵实测）。
 *
 * ## 量到的代价
 *
 * 本地 e2e lane 从来没设过 `SKILL_SANDBOX_MODULES_DIR`（只有 Dockerfile 设了），
 * 于是 `work/node_modules` 那条软链根本没建。十任务 Office 矩阵连续三轮 **0/10**，
 * 每一次的真实死因都是同一行 `Cannot find module 'pptxgenjs'` —— 而这行 stderr
 * 要穿过「沙箱 → 重试三次 → 应用层日志」才可能被人看到，那条链上当时还有两处丢信息。
 * 结果屏幕上和日志里都只剩「模型没产出文件」，一个配置缺失伪装成了产品缺陷。
 *
 * 所以判据放在**启动**，不放在第 19 次脚本失败。
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertUsableModulesDir } from "../src/preinstalled-modules.js";

const REQUIRED = ["pptxgenjs", "docx", "exceljs", "pdf-lib"];

function treeWith(present: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "modules-gate-"));
  for (const name of present) mkdirSync(join(root, name));
  return root;
}

describe("预装依赖目录的启动门", () => {
  it("四个库齐全 ⇒ 放行", () => {
    expect(() => { assertUsableModulesDir(treeWith(REQUIRED)); }).not.toThrow();
  });

  it("缺任何一个 ⇒ 当场抛，且报错指名缺了哪个", () => {
    const dir = treeWith(["pptxgenjs", "docx"]);
    expect(() => { assertUsableModulesDir(dir); }).toThrow(/exceljs/);
    expect(() => { assertUsableModulesDir(dir); }).toThrow(/pdf-lib/);
  });

  it("目录整个不存在 ⇒ 抛，不当成「配了就算数」", () => {
    expect(() => { assertUsableModulesDir("/nonexistent/modules"); }).toThrow(/pptxgenjs/);
  });

  /*
   * 没配**不抛**——沿用本文件既有纪律（沙箱也用于不跑脚本的场景）。
   * 但必须留下一行显眼的 stderr：这一条就是三天排查与三分钟排查的差别。
   */
  it("完全没配 ⇒ 不抛，但把「产不了 office 文件」这件事印出来", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(() => { assertUsableModulesDir(undefined); }).not.toThrow();
    expect(() => { assertUsableModulesDir(""); }).not.toThrow();
    const said = write.mock.calls.map((c) => String(c[0])).join("");
    expect(said).toContain("SKILL_SANDBOX_MODULES_DIR");
    expect(said).toContain("pptxgenjs");
    write.mockRestore();
  });
});
