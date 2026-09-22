/**
 * 手工排查用的对比度审计 CLI。**判据不在这里**——在 `e2e/support/text-contrast.ts`，
 * 与 CI 门控（`e2e/prototype-audit.spec.ts`）共用同一份。这个文件只负责「开浏览器、
 * 灌登录态、把结果印成人能读的样子」。
 *
 * 用法：
 *   pnpm exec tsx scripts/audit-text-contrast.ts <url> [更多 url…]
 *   SESSION_JSON='{"userId":…,"orgs":[…],"currentOrgId":…,"expiresAt":…,"token":…}' 给登录态
 *
 * 退出码：有「不通过」或「未审到」⇒ 1。「判不了」如实打印但不单独决定退出码
 * （它需要人看一眼，而不是拦住一次排查）。
 */
import { chromium } from "@playwright/test";
import { AA_LARGE, AA_NORMAL, auditTextContrast } from "../e2e/support/text-contrast";

/* apps/web 不是 ESM 包（package.json 无 `type: module`），tsx 编成 CJS，
 * 顶层 await 不可用，所以整段包进 `main()`。 */
async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("用法：pnpm exec tsx scripts/audit-text-contrast.ts <url>…");
    process.exit(2);
  }
  const session = process.env.SESSION_JSON === undefined ? null : JSON.parse(process.env.SESSION_JSON) as {
    userId: string; orgs: string[]; currentOrgId: string; expiresAt: string; token: string;
  };

  /** 低于这个候选元素数就认为「这页没渲染出来」——空白页与全通过在输出上无法分辨。 */
  const MIN_EXAMINED = 40;

  const browser = await chromium.launch();
  let failed = 0;
  let undetermined = 0;
  const unaudited: string[] = [];

  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    /*
     * tsx（esbuild）会给函数加 `__name(...)` 的 keepNames 包装，而 `page.evaluate` 是把
     * 函数**序列化**进页面执行的——页面里没有 `__name`，于是判据一进去就 ReferenceError。
     * CI 门控那条走 playwright 自己的 TS 转换，不加这层包装，所以只有这个 CLI 需要它。
     * 在页面里补一个恒等实现即可；这不影响判据本身。
     */
    await page.addInitScript(() => {
      (globalThis as unknown as { __name?: <T>(fn: T) => T }).__name ??= (fn) => fn;
    });
    // 浅色主题：深色主题会把这一整类缺陷藏起来（同一个 token 在深色下是近黑色）
    await page.emulateMedia({ colorScheme: "light" });
    if (session !== null) {
      await page.goto(new URL("/login", url).toString());
      await page.evaluate((s) => {
        const rev = crypto.randomUUID();
        window.localStorage.setItem("wsx.session", JSON.stringify({
          version: 2, revision: rev, userId: s.userId, orgs: s.orgs,
          currentOrgId: s.currentOrgId, expiresAt: s.expiresAt,
        }));
        window.localStorage.setItem("wsx.sessionToken", s.token);
        window.localStorage.setItem("wsx.sessionCommit", rev);
        window.localStorage.setItem("wsx.theme", "light");
      }, session);
    }
    try {
      // dev 模式下第一次进某条路由要现编译，默认 30 s 不够
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    } catch (error) {
      console.log(`\n════ ${url}\n   ⚠ 打不开（${String(error).split("\n")[0]}）——本页计为未审到。`);
      unaudited.push(url);
      await page.close();
      continue;
    }
    await page.waitForTimeout(4000);
    const r = await page.evaluate(auditTextContrast, { aaNormal: AA_NORMAL, aaLarge: AA_LARGE });
    console.log(`\n════ ${url}`);
    console.log(`   examined=${String(r.examined)} bodyChars=${String(r.bodyChars)} —— 不通过 ${String(r.fail.length)} ｜ 判不了 ${String(r.unknown.length)} ｜ 声明例外 ${String(r.exempt.length)} ｜ 透明跳过 ${String(r.transparent)}`);
    for (const h of r.fail) {
      console.log(`  ✗ ${String(h.ratio).padStart(5)} < ${String(h.threshold)}  ${h.tag}${h.testid === null ? "" : `[${h.testid}]`}  ${h.fg} on ${h.bg}`);
      console.log(`         「${h.sample}」  class=${h.cls}`);
    }
    for (const h of r.exempt) console.log(`  · 声明例外  ${h.tag}${h.testid === null ? "" : `[${h.testid}]`}  —— ${h.why}`);
    for (const h of r.unknown) {
      console.log(`  ? 判不了  ${h.tag}${h.testid === null ? "" : `[${h.testid}]`}  —— ${h.why}`);
      console.log(`         「${h.sample}」  class=${h.cls}`);
    }
    if (r.examined < MIN_EXAMINED) {
      console.log(`   ⚠ 只审到 ${String(r.examined)} 个元素——这更像是页面没渲染出来（重定向/空态/未登录），不是「全都通过」。本页计为未审到。`);
      unaudited.push(url);
    }
    failed += r.fail.length;
    undetermined += r.unknown.length;
    await page.close();
  }
  await browser.close();
  console.log(`\n合计：不通过 ${String(failed)} 处，判不了 ${String(undetermined)} 处（判不了**不算通过**）。`);
  if (unaudited.length > 0) console.log(`未审到 ${String(unaudited.length)} 个页面（渲染不出来，不是通过）：\n  ${unaudited.join("\n  ")}`);
  process.exit(failed > 0 || unaudited.length > 0 ? 1 : 0);
}

void main();
