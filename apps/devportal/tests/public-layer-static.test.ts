// p30-F02 静态断言：公开层（/explore、/projects/:slug、/u/:handle、/a/:handle/:agent）
// 组件零身份读取、零 Access 依赖（D3：公开层不得依赖 Access 注入 header）。
// 从四个公开路由入口出发，沿 "@/…" 与相对 import 递归收集 devportal 内源文件，
// 逐文件断言不出现身份读取面。任何公开层组件回退（import lib/access / 读 cookie）
// 都会让本用例真实变红——这是 feature_list F02 notes 点名的防空跑用例。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = resolve(__dirname, "..");

const PUBLIC_ENTRIES = [
  "app/explore/page.tsx",
  "app/projects/[slug]/page.tsx",
  "app/u/[handle]/page.tsx",
  "app/a/[handle]/[agent]/page.tsx",
];

/** 身份读取面黑名单（命中即红）。 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /from\s+["']@\/lib\/access["']/, why: "公开层禁止 import lib/access.ts" },
  { pattern: /from\s+["']@\/lib\/session["']/, why: "公开层禁止 import lib/session.ts" },
  { pattern: /from\s+["']next\/headers["']/, why: "公开层禁止 next/headers（cookies()/headers()）" },
  { pattern: /\bcookies\s*\(/, why: "公开层禁止读 cookie" },
  { pattern: /\bheaders\s*\(\s*\)/, why: "公开层禁止读请求头" },
  { pattern: /cf-access/i, why: "公开层禁止任何 Cf-Access-* header 依赖" },
  // D13 / backlog F1：公开层拆到独立域名后，公开页也不许读协作层数据（协调面 / 目录 /
  // 派工 / 仓库文件 / 工作区授权 / 带重认证的 portal API 客户端 / 接入向导）。
  ...[
    "access",
    "session",
    "coord-gateway",
    "coord-stream",
    "agents-gateway",
    "agent-runtimes",
    "directory",
    "dispatch",
    "repo-files",
    "workspace-authz",
    "portal-fetch",
    "onboard",
    "onboarding-issue",
    "oauth",
    "p30-me-types",
    "pr-nudge-guard",
  ].map((mod) => ({
    pattern: new RegExp(`from\\s+["'](?:@/lib|(?:\\.\\./)+lib)/${mod}["']`),
    why: `公开层禁止 import 协作层数据模块 lib/${mod}.ts（D13）`,
  })),
  { pattern: /["'`]\/api\//, why: "公开层禁止调用任何 /api/* 接口（公开主机上它们一律 404，D13）" },
];


function tryResolve(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(APP_ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // 外部包不追
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

function collectClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((e) => join(APP_ROOT, e));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"'`;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const resolved = tryResolve(spec, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

describe("公开层静态断言（D3 阶段 2）", () => {
  it("四个公开路由入口都真实存在（防路由被删导致断言空跑）", () => {
    for (const entry of PUBLIC_ENTRIES) {
      expect(statSync(join(APP_ROOT, entry)).isFile(), entry).toBe(true);
    }
  });

  it("公开层 import 闭包内零身份读取（禁 lib/access / lib/session / cookie / headers / Cf-Access）", () => {
    const files = collectClosure(PUBLIC_ENTRIES);
    expect(files.length).toBeGreaterThanOrEqual(PUBLIC_ENTRIES.length); // 闭包非空
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(src)) violations.push(`${file.replace(`${APP_ROOT}/`, "")}: ${why}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("middleware 在读会话之前先做主机名路由（公开层零鉴权，D13）", () => {
    const src = readFileSync(join(APP_ROOT, "middleware.ts"), "utf8");
    const decideAt = src.indexOf("decideRoute(");
    const sessionAt = src.indexOf("resolveSession(request");
    expect(decideAt, "middleware 必须调用 decideRoute").toBeGreaterThan(-1);
    expect(sessionAt).toBeGreaterThan(decideAt);
  });

  it("门控会真的变红：注入一个 import 协作层数据的文件即命中（防空跑）", () => {
    const bad = 'import { fetchCoordination } from "@/lib/coord-gateway";\nfetch("/api/portal/prs");';
    const hits = FORBIDDEN.filter(({ pattern }) => pattern.test(bad));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
