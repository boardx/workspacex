/**
 * 每个维度 = 一段用户旅程（在真浏览器里走一遍、记下用户看到的东西）+ 若干条检查（对着记下来的东西断言）。
 *
 * 为什么不是「每条检查自己走一遍」：E2 一段旅程就是 30 轮对话，每条检查重走一遍要几十分钟；而 Playwright 在一条
 * 测试失败后会重启 worker、重跑 beforeAll——一条检查红了，整段旅程就得重来一次，还会在同一个库里多出一份对话。
 * 所以旅程在 beforeAll 里走**一次**，观察落到 `test-results/kg-experience-eval/obs/<维度>.json`（同一次运行内复用，
 * 按运行号区分），检查只读它。旅程中途出错不抛：记下出错的那一步，之前看到的照样留着——依赖后面那几步的检查
 * 会因为「没看到」而红，并带上出错原因（诚实地红，而不是整维被跳过）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { KgEvalAccount } from "./fixture";
import { login } from "./eval-helpers";

const OBS_DIR = join(__dirname, "..", "..", "test-results", "kg-experience-eval", "obs");

export interface Journal {
  readonly runId: string;
  /** 记下的观察：键 → 值（都是用户看得见的东西：文字、个数、位置、毫秒数）。 */
  readonly seen: Record<string, unknown>;
  /** 键 → 截图文件（jpeg，裁到相关元素）。 */
  readonly shots: Record<string, string>;
  /** 旅程在哪一步停下的（没停 ⇒ null）。 */
  readonly abortedAt: string | null;
  readonly error: string | null;
}

export interface JourneyCtx {
  /** 以某个账号开一个已登录的页面（各账号各自一个浏览器上下文，互不串会话）。 */
  pageAs(account: KgEvalAccount): Promise<Page>;
  /** 标一下现在走到哪一步（出错时报这一步）。 */
  step(name: string): void;
  see(key: string, value: unknown): void;
  shot(key: string, target: Locator | Page): Promise<void>;
}

export async function runJourney(
  dim: string,
  browser: Browser,
  body: (ctx: JourneyCtx) => Promise<void>,
): Promise<Journal> {
  const runId = process.env.KG_EVAL_RUN_ID ?? "local";
  mkdirSync(OBS_DIR, { recursive: true });
  const file = join(OBS_DIR, `${dim}.json`);
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as Journal;
    if (cached.runId === runId) return cached;
  }
  const seen: Record<string, unknown> = {};
  const shots: Record<string, string> = {};
  const contexts: BrowserContext[] = [];
  let current = "开始";
  let error: string | null = null;
  const ctx: JourneyCtx = {
    async pageAs(account) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      contexts.push(c);
      const page = await c.newPage();
      await login(page, account);
      return page;
    },
    step(name) { current = name; },
    see(key, value) { seen[key] = value; },
    async shot(key, target) {
      const path = join(OBS_DIR, `${dim}-${key}.jpg`);
      try {
        writeFileSync(path, await target.screenshot({ type: "jpeg", quality: 55 }));
        shots[key] = path;
      } catch {
        // 截不到图（元素不在）不影响观察本身；证据缺失由门判红。
      }
    },
  };
  try {
    await body(ctx);
  } catch (e) {
    error = e instanceof Error ? e.message.replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 3).join(" ").slice(0, 400) : String(e);
    // 停下来那一刻用户看到的样子，留作证据（也是排查的第一手材料）。
    for (const [i, c] of contexts.entries()) {
      for (const [k, p] of c.pages().entries()) await ctx.shot(`aborted-${i}-${k}`, p);
    }
  } finally {
    for (const c of contexts) await c.close().catch(() => undefined);
  }
  const journal: Journal = { runId, seen, shots, abortedAt: error === null ? null : current, error };
  writeFileSync(file, JSON.stringify(journal, null, 2));
  return journal;
}

/** 检查里取一条观察；旅程没走到这里 ⇒ 带着旅程停下的原因红。 */
export function seen<T>(j: Journal, key: string): T {
  const where = j.abortedAt === null ? "" : `（旅程停在「${j.abortedAt}」：${j.error}）`;
  expect(key in j.seen, `没看到「${key}」${where}`).toBe(true);
  return j.seen[key] as T;
}

/** 把旅程里的截图与这条检查量到的数挂到检查上（score.mjs 收进 evidence/）。 */
export async function attach(testInfo: TestInfo, j: Journal, shotKeys: readonly string[], measure?: Record<string, unknown>): Promise<void> {
  if (measure !== undefined) {
    await testInfo.attach("measure", { body: JSON.stringify(measure), contentType: "application/json" });
  }
  for (const k of shotKeys) {
    const p = j.shots[k];
    if (p !== undefined && existsSync(p)) await testInfo.attach("shot", { path: p, contentType: "image/jpeg" });
  }
}
