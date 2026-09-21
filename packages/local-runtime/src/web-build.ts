/**
 * `next start` 的产物是**在 build 那一刻就把 API 地址编译进去**的，而 `up` 的端口是在
 * 启动那一刻才决定的。这两件事之间没有任何东西在把关。
 *
 * ## 这个缺口长什么样
 *
 * `NEXT_PUBLIC_*` 是 Next 把值内联进客户端 bundle 的唯一方式（`apps/web/lib/api-client.ts`
 * 的文件头就是这么写的）。于是：
 *
 *   1. 用户按文档跑 `NEXT_PUBLIC_API_URL=http://127.0.0.1:3200 pnpm --filter web build`；
 *   2. 后来因为 3200 被占，用 `--ports api=3300` 重启；
 *   3. 页面正常打开、样式正常、没有任何报错——**每一个 API 请求都打向 3200**，
 *      那里要么没人，要么是别的程序。
 *
 * 用户看到的是「登录转圈」「列表一直空」。日志里什么都没有，因为请求根本没到 API。
 * 桌面外壳更容易踩到：它只要看见 `.next/BUILD_ID` 存在就用 `start` 模式。
 *
 * ## 判据
 *
 * 产物里能不能找到本次运行期望的那个源地址字面量。找得到 ⇒ 至少是按这个地址烘焙的；
 * 找不到 ⇒ 一定不是。
 *
 * ⚠ 这是**存在性**检查，不是等价性证明：产物里可能同时留着别的地址（历史构建的 chunk）。
 *   它能挡住的正是上面那个场景，而那是这个缺口的全部实际形态。
 * ⚠ 云端把 `NEXT_PUBLIC_API_URL` 设成相对路径 `/api`，在浏览器里按 `window.location.origin`
 *   解析——所以云端换域名不用重新构建，也根本没有这个问题。本地版走的是跨端口直连
 *   （web 3100 → api 3200），才需要这一道检查。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** `next build` 的产物目录（相对 `apps/web`）。 */
export const WEB_BUILD_DIR = ".next";

export function webBuildExists(webAppDir: string): boolean {
  return existsSync(join(webAppDir, WEB_BUILD_DIR, "BUILD_ID"));
}

/**
 * 产物的客户端 chunk 里有没有出现这个字面量。
 *
 * 只扫 `.next/static`（客户端 bundle 就在这里），并且**跳过 source map**：`.map` 里会
 * 原样带上源码文本，`process.env.NEXT_PUBLIC_API_URL` 这种没被替换的写法也在里面，
 * 扫到了会把「烘焙过」误判成真。
 */
export function bakedIntoWebBuild(webAppDir: string, literal: string): boolean {
  const staticDir = join(webAppDir, WEB_BUILD_DIR, "static");
  if (!existsSync(staticDir)) return false;
  for (const file of walk(staticDir)) {
    if (file.endsWith(".map")) continue;
    if (readFileSync(file, "utf8").includes(literal)) return true;
  }
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export interface WebBuildCheck {
  readonly usable: boolean;
  /** `usable` 为 false 时，一句告诉用户到底该做什么的话。 */
  readonly reason: string | null;
}

/**
 * `next start` 之前必须过的这一关。
 *
 * ⚠ 不可用时**不静默退回 `next dev`**：dev 模式每次首屏都要现编译，在装机场景下
 *   会被当成「这软件真慢」，而真正的原因（产物是按另一个端口烘焙的）一个字都没说。
 *   宁可失败并给出那条重新构建的命令。
 */
export function checkWebBuild(webAppDir: string, expectedApiUrl: string): WebBuildCheck {
  if (!webBuildExists(webAppDir)) {
    return { usable: false, reason: `${join(webAppDir, WEB_BUILD_DIR)} 里没有构建产物；先构建，或用 --web dev 启动。` };
  }
  if (bakedIntoWebBuild(webAppDir, expectedApiUrl)) return { usable: true, reason: null };
  return {
    usable: false,
    reason:
      `Web 产物不是按 ${expectedApiUrl} 构建的——NEXT_PUBLIC_* 在构建期就被编译进了客户端代码，\n` +
      "  端口对不上时页面能打开、样式正常、一个报错也没有，但每个 API 请求都打向旧地址。\n" +
      `  重新构建：NEXT_PUBLIC_API_URL=${expectedApiUrl} pnpm --filter web build\n` +
      "  或者用 --web dev 启动（首屏慢，但地址在运行期读）。",
  };
}
