/**
 * 进程入口。
 *
 * ## ⚠ 为什么监听 unix socket,而不是 TCP 端口
 *
 * contract §4 要求执行不可信脚本的容器 `network: none`。但 `apps/api` 又必须能把
 * 请求送进来 —— 这两件事在 TCP 上是**直接矛盾**的:`network: none` 的容器没有
 * 任何网络接口,外面根本连不上。
 *
 * 三条出路,选了第三条:
 * ① 让沙箱容器保留网络 ⇒ 直接违反 contract §4 与 V2-b,不考虑。
 * ② 服务容器保留网络,每次执行再起一个 `network: none` 的临时容器 ⇒ 需要把
 *    docker socket 挂进服务里,那等同于给它宿主 root 权限,**净损失**:为了收紧
 *    网络而放开了一个大得多的逃逸面。
 * ③ **容器 `network: none`,通过共享 volume 上的 unix domain socket 通信**。
 *    网络边界是字面意义上的"没有网络",同时 apps/api 仍能调用(`http.request`
 *    的 `socketPath`)。没有额外特权。
 *
 * ⚠ 这一条是 contract §4 没有写到的落地细节,不是对它的放宽 —— 它比"开一个端口"
 *   **更严**。已在 #1583 记录。
 *
 * TCP 监听仅用于本地开发与单测(`SKILL_SANDBOX_PORT`),生产/门控走 socket。
 */
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createSandboxServer } from "./server.js";

const socketPath = process.env.SKILL_SANDBOX_SOCKET;

/**
 * 镜像里 pptxgenjs 的预装位置(见 Dockerfile)。⚠ 不给内建 fallback:
 * 读不到就是读不到,脚本会以"找不到模块"失败并把真实 stderr 回喂给模型,
 * 而不是让服务假装自己配好了。
 */
const preinstalledModulesDir = process.env.SKILL_SANDBOX_MODULES_DIR;

const server = createSandboxServer({ preinstalledModulesDir });

if (socketPath !== undefined && socketPath !== "") {
  // 重启时清掉上一次留下的 socket 文件,否则 EADDRINUSE。
  if (existsSync(socketPath)) unlinkSync(socketPath);
  server.listen(socketPath, () => {
    try {
      // 0o660:同组的 apps/api 能连,其他用户不能。
      chmodSync(socketPath, 0o660);
    } catch (e) {
      /**
       * ⚠ 尽力而为,**不因此让服务起不来**。
       *
       * socket 落在 bind mount 上时,某些文件系统(Docker Desktop 在 macOS 上的
       * virtiofs 就是)不支持对 socket 节点 chmod,报 `EINVAL`。实测(#1583)这会
       * 让容器在 listen 回调里直接崩溃、socket 永远不可用,而真正的访问控制其实
       * 由**所在目录**的权限决定 —— 那一层不受这个限制影响。
       *
       * ⇒ 收紧失败时记一行日志继续跑,而不是把一个加固措施变成可用性故障。
       */
      process.stdout.write(
        `skill-sandbox: could not tighten socket mode (${e instanceof Error ? e.message : String(e)}); ` +
          `relying on the permissions of the containing directory\n`,
      );
    }
    process.stdout.write(`skill-sandbox listening on unix:${socketPath}\n`);
  });
} else {
  const port = Number(process.env.SKILL_SANDBOX_PORT ?? "8790");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `SKILL_SANDBOX_PORT must be a positive integer, got ${String(process.env.SKILL_SANDBOX_PORT)}`,
    );
  }
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`skill-sandbox listening on ${port}\n`);
  });
}
