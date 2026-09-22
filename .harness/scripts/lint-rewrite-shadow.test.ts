/**
 * `lint-rewrite-coverage` 反方向（#610）的**端到端**反证：真的 spawn 脚本。
 *
 * 判定逻辑本身的 fixture 单测在 lib/rewrite-shadow.test.ts。这里断的是**接线**——
 * 脚本有没有真的去读页面路由、有没有真的去求值 next.config.mjs 的 `rewrites()`、
 * 判红之后退出码是不是非 0。这一层单独断，是因为 #539 那道门历史上栽过的正是接线：
 * 规范早就有、门一直没装（AGENTS.md「没有脚本的规范条目视为未落地」）。
 *
 * ⚠ 全部用例都**不带 `--strict`**：fixture 根目录里没有 controller，正方向会降级成
 *   WARN（扫不全，不下结论）。不带 `--strict` 时那条降级退出 0，于是退出码只反映
 *   反方向的判定——用例才真的在断反方向，而不是在断「空目录会红」。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, ".harness", "scripts", "lint-rewrite-coverage.mjs");

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

function run(args: string[]): { code: number; out: string } {
  // 退出 0 的样本也要看 stderr：降级 WARN 走的是 console.warn，不在 stdout 上。
  const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * 造一个最小仓库根：一个前端动态页面路由 + 一份真的会被求值的 next.config.mjs。
 * config 从 `CHAT_READ_E2E_API_ORIGIN` 取 apiOrigin——脚本必须把它喂进来，
 * 否则这里拿到 undefined，规则的 destination 不带 protocol，遮蔽判定就会静默失效。
 */
function fixture(options: { rewrites: string; allowlist?: unknown }): string {
  const root = mkdtempSync(join(tmpdir(), "rewrite-shadow-"));
  mkdirSync(join(root, "apps/web/app/admin/[module]"), { recursive: true });
  writeFileSync(join(root, "apps/web/app/admin/[module]/page.tsx"), "export default function Page() {}\n");
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "apps/web/next.config.mjs"), `
export default {
  async rewrites() {
    const apiOrigin = process.env.CHAT_READ_E2E_API_ORIGIN;
    return { afterFiles: ${options.rewrites} };
  },
};
`);
  if (options.allowlist !== undefined) {
    mkdirSync(join(root, ".harness/state"), { recursive: true });
    writeFileSync(
      join(root, ".harness/state/rewrite-shadow-allowlist.json"),
      JSON.stringify(options.allowlist),
    );
  }
  return root;
}

/** #610 原始现场逐字：`/admin/:path*` 把整片前端管理后台代理到 API。 */
const SHADOWING = "[{ source: `/admin/:path*`, destination: `${apiOrigin}/admin/:path*` }]";
/** 收窄成逐条 API 命名空间（作者在 #595 里实际做的修法）。 */
const NARROWED = "[{ source: `/admin/skills/:path*`, destination: `${apiOrigin}/admin/skills/:path*` }]";
const ENTRY = { route: "/admin/[module]", rewrite: "/admin/:path*", reason: "反证用" };

describe("lint-rewrite-coverage 反方向接线（#610）", () => {
  it("① 加一条遮蔽既有前端页面的通配 rewrite → 退出非 0，并点名那条规则与那个页面", () => {
    dir = fixture({ rewrites: SHADOWING });
    const r = run(["--root", dir]);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("/admin/[module]");
    expect(r.out).toContain("/admin/:path*");
  });

  it("② 同一条遮蔽带理由登记进棘轮 → 退出 0（棘轮是出口，不是把门改松）", () => {
    dir = fixture({ rewrites: SHADOWING, allowlist: { shadows: [ENTRY] } });
    const r = run(["--root", dir]);
    expect(r.code, r.out).toBe(0);
  });

  it("③ 棘轮条目没有 reason → 不算登记，照样红", () => {
    dir = fixture({ rewrites: SHADOWING, allowlist: { shadows: [{ ...ENTRY, reason: "  " }] } });
    const r = run(["--root", dir]);
    expect(r.code, r.out).not.toBe(0);
  });

  it("④ 遮蔽修好了、棘轮条目还留着 → 报陈旧并退出非 0（另一个方向的反证）", () => {
    dir = fixture({ rewrites: NARROWED, allowlist: { shadows: [ENTRY] } });
    const r = run(["--root", dir]);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("已经不遮了");
  });

  it("⑤ 通配收窄之后 → 退出 0（正样本：门不是恒红）", () => {
    dir = fixture({ rewrites: NARROWED });
    const r = run(["--root", dir]);
    expect(r.code, r.out).toBe(0);
  });

  it("⑥ 真仓库：反方向真的跑到了，而且是拿真实页面路由与求值后的规则在判", () => {
    // 不断具体数字（页面与规则天天在长），断的是「这一半没有静默跳过」。
    const r = run([]);
    expect(r.out).toContain("✓ [rewrite-shadow]");
    expect(r.out).toMatch(/\[rewrite-shadow\][^\n]*条动态页面路由/);
    expect(r.out).not.toContain("! [rewrite-shadow] 扫不全");
  });
});
