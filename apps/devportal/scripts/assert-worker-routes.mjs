// assert-worker-routes.mjs —— 构建产物的路由门控（#3889 之后的真实事故）
//
// 2026-09-23：develop.boardx.us 根路径对已登录用户返回纯文本 "Not Found"。
// /me 正常、CI 全绿、部署成功、生产 smoke 也通过——因为 smoke 是匿名跑的，
// Cloudflare Access 在边缘就把 `/` 302 走了，**永远到不了源站**，那条断言
// 证明的是 Access 还在，不是根页面还在。
//
// 根因在 @cloudflare/next-on-pages 的 applyVercelOverrides（见 patches/）：
// Next 产出的 override `_next/static/not-found.txt` 没有 `path` 字段，
// `addLeadingSlash(undefined ?? "")` 把它变成 `"/"`，于是根路由被 404 资源覆盖。
//
// 这道门直接读构建产物的路由表——不出网、不需要凭据、不受 Access 影响：
// 每条产品页面路由都必须是 function/middleware，不能是静态 override。
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WORKER = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  ".vercel/output/static/_worker.js/index.js",
);

// 必须由边缘函数服务的路由。`/` 排第一：它是被真实事故打中的那一条。
const MUST_BE_FUNCTION = ["/", "/me", "/explore", "/onboard", "/portal"];

/** 从产物里抠出 `"<路由>":{type:"...",...}` 的 type。产物是 bundler 输出的单文件，
 *  没有可导入的入口，所以按字面量取——取不到即判失败，不当成通过。 */
function routeType(source, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`"${escaped}":\\{type:"([a-z]+)"`));
  return match?.[1] ?? null;
}

const source = await readFile(WORKER, "utf8").catch(() => null);
if (source === null) {
  console.error(`✗ 找不到构建产物：${WORKER}\n  先跑 pnpm build && pnpm exec next-on-pages`);
  process.exit(1);
}

const failures = [];
for (const route of MUST_BE_FUNCTION) {
  const type = routeType(source, route);
  if (type === "function" || type === "middleware") continue;
  failures.push(
    type === null
      ? `${route} —— 路由表里根本没有这一条（页面不会被服务，直接 404）`
      : `${route} —— type="${type}"，期望 function/middleware（静态 override 会顶掉页面）`,
  );
}

if (failures.length > 0) {
  console.error("✗ 构建产物的路由表不对：");
  for (const line of failures) console.error(`    ${line}`);
  console.error("  这正是 2026-09-23 根路径返回 \"Not Found\" 的形状，见本文件头部与 patches/。");
  process.exit(1);
}

console.log(`✓ 路由表：${MUST_BE_FUNCTION.join(" ")} 均由边缘函数服务`);
