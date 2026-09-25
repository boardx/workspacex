/**
 * 这一关挡住的是本地版里**最难被发现**的一类故障：页面正常打开、样式正常、控制台干净，
 * 而每一个 API 请求都打向另一个端口。它没有任何症状可循，因为请求根本没到 API，
 * 日志里也就什么都没有。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bakedIntoWebBuild, checkWebBuild, webBuildExists } from "../src/web-build";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** 造一个最小的 `.next` 产物：BUILD_ID + 一个客户端 chunk（+ 可选的 source map）。 */
function fakeBuild(chunk: string, sourceMap?: string): string {
  const web = mkdtempSync(join(tmpdir(), "wsx-web-"));
  dirs.push(web);
  mkdirSync(join(web, ".next", "static", "chunks"), { recursive: true });
  writeFileSync(join(web, ".next", "BUILD_ID"), "test-build");
  writeFileSync(join(web, ".next", "static", "chunks", "main.js"), chunk);
  if (sourceMap !== undefined) writeFileSync(join(web, ".next", "static", "chunks", "main.js.map"), sourceMap);
  return web;
}

describe("web build provenance", () => {
  it("accepts a build baked with the origin this run will serve", () => {
    const web = fakeBuild('fetch("http://127.0.0.1:3200/auth/login")');
    expect(webBuildExists(web)).toBe(true);
    expect(checkWebBuild(web, "http://127.0.0.1:3200")).toEqual({ usable: true, reason: null });
  });

  it("refuses a build baked for a different port, and says how to fix it", () => {
    const web = fakeBuild('fetch("http://127.0.0.1:3200/auth/login")');
    const check = checkWebBuild(web, "http://127.0.0.1:3300");
    expect(check.usable).toBe(false);
    expect(check.reason).toContain("NEXT_PUBLIC_API_URL=http://127.0.0.1:3300");
    expect(check.reason).toContain("--web dev");
  });

  it("does not count a source map as evidence the value was baked in", () => {
    // `.map` 里带着未被替换的源码文本；把它算作证据，会把「没烘焙」误判成「烘焙了」。
    const web = fakeBuild(
      'fetch(API_BASE+"/auth/login")',
      JSON.stringify({ sourcesContent: ['process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3300"'] }),
    );
    expect(bakedIntoWebBuild(web, "http://127.0.0.1:3300")).toBe(false);
    expect(checkWebBuild(web, "http://127.0.0.1:3300").usable).toBe(false);
  });

  it("reports a missing build as a missing build, not as a mismatch", () => {
    const web = mkdtempSync(join(tmpdir(), "wsx-web-"));
    dirs.push(web);
    expect(webBuildExists(web)).toBe(false);
    expect(checkWebBuild(web, "http://127.0.0.1:3200").reason).toContain("没有构建产物");
  });
});
