// 公开层拆域（D13 / backlog F1）：主机名路由的行为测试——直接调真实 middleware。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { PUBLIC_HOST_PLACEHOLDER, configuredPublicHost, decideRoute, joinHrefFor } from "@/lib/public-host";

const PUBLIC = "public.example.test";
const COLLAB = "collab.example.test";

function req(host: string, path: string, cookie?: string): NextRequest {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`https://${host}${path}`, { headers });
}

describe("公开层拆域：主机名路由（middleware）", () => {
  beforeEach(() => {
    vi.stubEnv("DEVPORTAL_PUBLIC_HOST", PUBLIC);
    vi.stubEnv("SESSION_SECRET", "x".repeat(40));
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["/explore", "/projects/demo", "/u/alice", "/a/alice/bot", "/_next/static/chunks/x.js"])(
    "公开主机放行公开页 %s（无会话、不跳登录）",
    async (path) => {
      const res = await middleware(req(PUBLIC, path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each([
    "/",
    "/me",
    "/me/agents",
    "/p/demo",
    "/p/demo/settings",
    "/onboard",
    "/portal",
    "/platform/dispatcher",
    "/api/portal/prs",
    "/api/p30/me",
    "/api/coord/oauth/github/login",
    "/explorer", // 前缀相似但不是公开页
  ])("公开主机够不到协作层 %s → 404（不跳登录、不暴露其存在）", async (path) => {
    const res = await middleware(req(PUBLIC, path, "wsx_session=forged"));
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("公开主机名匹配忽略大小写与端口", async () => {
    expect((await middleware(req("PUBLIC.example.test:443", "/p/demo"))).status).toBe(404);
  });

  it.each(["/me", "/p/demo/work", "/onboard"])("协作主机仍然门控 %s：无会话 → 302 登录", async (path) => {
    const res = await middleware(req(COLLAB, path));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/api/coord/oauth/github/login");
  });

  it("协作主机上的公开页 308 搬到公开主机（保留路径与查询）", async () => {
    const res = await middleware(req(COLLAB, "/projects/demo?tab=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`https://${PUBLIC}/projects/demo?tab=1`);
  });

  it("协作主机治理面不被 middleware 触碰（Access 在边缘把门）", async () => {
    const res = await middleware(req(COLLAB, "/portal"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("公开主机名配置（单一 env，占位即未配置）", () => {
  it("占位值 / 空值 = 尚未拆域", () => {
    expect(configuredPublicHost(PUBLIC_HOST_PLACEHOLDER)).toBeNull();
    expect(configuredPublicHost("")).toBeNull();
    expect(configuredPublicHost(undefined)).toBeNull();
  });

  it("公开页的加入链接指向协作主机 /join/:slug；未配置协作主机则同主机相对路径", () => {
    expect(joinHrefFor("boardx", COLLAB)).toBe(`https://${COLLAB}/join/boardx`);
    expect(joinHrefFor("boardx", undefined)).toBe("/join/boardx");
    expect(decideRoute({ host: PUBLIC, pathname: "/join/boardx", search: "", publicHost: PUBLIC }).kind).toBe(
      "public-not-found",
    );
  });

  it("未拆域时行为与拆域前一致：公开页直通，工作区仍要会话", () => {
    const base = { search: "", publicHost: null, host: COLLAB };
    expect(decideRoute({ ...base, pathname: "/explore" }).kind).toBe("pass");
    expect(decideRoute({ ...base, pathname: "/p/x" }).kind).toBe("require-session");
  });

  it("wrangler.toml 声明 DEVPORTAL_PUBLIC_HOST；占位值时部署门控脚本必须失败", () => {
    const root = join(__dirname, "..");
    const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
    const value = /^\s*DEVPORTAL_PUBLIC_HOST\s*=\s*"([^"]*)"/m.exec(toml)?.[1];
    expect(value, "DEVPORTAL_PUBLIC_HOST 必须在 wrangler.toml [vars] 声明").toBeDefined();
    const run = () => execFileSync("node", [join(root, "scripts/assert-public-host.mjs")], { stdio: "pipe" });
    if (value === PUBLIC_HOST_PLACEHOLDER) expect(run).toThrow();
    else expect(run).not.toThrow();
    // 域名未选定时 CD 用 --allow-placeholder：占位值放行（只警告），但缺失仍失败
    const lenient = () =>
      execFileSync("node", [join(root, "scripts/assert-public-host.mjs"), "--allow-placeholder"], { stdio: "pipe" });
    expect(lenient).not.toThrow();
  });
});
