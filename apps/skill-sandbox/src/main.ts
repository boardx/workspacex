/** 进程入口。端口与预装依赖目录都从 env 读,没有内建默认的"猜一个"路径。 */
import { createSandboxServer } from "./server.js";

const port = Number(process.env.SKILL_SANDBOX_PORT ?? "8790");
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`SKILL_SANDBOX_PORT must be a positive integer, got ${String(process.env.SKILL_SANDBOX_PORT)}`);
}

/**
 * 镜像里 pptxgenjs 的预装位置(见 Dockerfile)。⚠ 不给内建 fallback:
 * 读不到就是读不到,脚本会以"找不到模块"失败并把真实 stderr 回喂给模型,
 * 而不是让服务假装自己配好了。
 */
const preinstalledModulesDir = process.env.SKILL_SANDBOX_MODULES_DIR;

createSandboxServer({ preinstalledModulesDir }).listen(port, "0.0.0.0", () => {
  process.stdout.write(`skill-sandbox listening on ${port}\n`);
});
