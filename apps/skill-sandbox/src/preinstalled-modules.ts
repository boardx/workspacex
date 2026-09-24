/**
 * 沙箱预装依赖目录的启动判据。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 配了就必须真的能用——**在启动时**判，不要等脚本失败。
 *
 * 2026-09-25 实测代价：本地 lane 根本没配这个变量，十任务真实模型 Office 矩阵
 * 连续三轮 0/10。每一轮的真实死因都是 `Cannot find module 'pptxgenjs'`，但它要经
 * 沙箱 → 重试三次 → 应用层日志 两道收窄才可能被人看到，而那条链上当时有两处丢信息，
 * 于是屏幕上和日志里都只剩「模型没产出文件」。一个配置缺失伪装成了三天的产品缺陷。
 *
 * 所以这里判两件事，都在服务起来之前：
 *   ① 配了却指向一棵没有 office 库的树 ⇒ 直接起不来（配错的地方当场红）。
 *   ② 压根没配 ⇒ **不兜底**（沿用本文件既有纪律：读不到就是读不到），但把这件事
 *      印成一行显眼的 stderr。沉默地少一个软链，和显式地说「这台沙箱产不了 office
 *      文件」，排查成本差三天。
 */
export function assertUsableModulesDir(dir: string | undefined): void {
  const required = ["pptxgenjs", "docx", "exceljs", "pdf-lib"];
  if (dir === undefined || dir === "") {
    process.stderr.write(
      `[skill-sandbox] SKILL_SANDBOX_MODULES_DIR 未配置：${required.join("/")} 都不可用，` +
        `任何 require 预装库的脚本都会以 MODULE_NOT_FOUND 失败。\n`,
    );
    return;
  }
  const missing = required.filter((m) => !existsSync(join(dir, m)));
  if (missing.length > 0) {
    throw new Error(
      `SKILL_SANDBOX_MODULES_DIR=${dir} 里缺少预装库：${missing.join(", ")}。` +
        `它必须是一棵扁平真实目录树（npm ci --omit=dev 的布局），` +
        `见 scripts/local-bundle/prepare-sandbox-modules.sh。`,
    );
  }
}
