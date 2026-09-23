/**
 * 发布脚本必须自己构建 web 产物，不能捡工作树里碰巧存在的那份（#3872 R15）。
 *
 * ## 实测怎么暴露的
 *
 * 我打了一个包去量启动时间，日志第一行是：
 *
 * ```
 * [web] 不使用已构建产物：…/bundle/apps/web/.next 里没有构建产物；先构建，或用 --web dev 启动。
 * ```
 *
 * 于是**打包出来的应用在用 `next dev` 跑界面**——每个页面在用户点开时才编译。
 * 对比：装在 /Applications 的那个 `.next` 有 `BUILD_ID`（64 MB，生产构建），
 * 我打的那个有 `cache/`、没有 `BUILD_ID`（154 MB，dev 产物）。
 *
 * 根因是 `dist:mac` 只跑 `build:main`（esbuild 主进程）就直接 electron-builder，
 * **web 产物完全取决于开发者的工作树当时是什么状态**。谁最后跑过一次 `next dev`，
 * 谁打出来的包就是 dev 模式的——而唯一的症状只是「启动慢」，没有任何报错。
 *
 * `checkWebBuild` 把它抓住并如实回退了（这个设计是对的），但一个发布产物
 * 本来就不该走到那条回退上。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("发布脚本", () => {
  for (const target of ["dist:mac", "dist:win"]) {
    it(`${target} 在打包之前先构建 web 产物`, () => {
      const s = pkg.scripts[target];
      expect(s, `${target} 不存在`).toBeTruthy();
      expect(s, `${target} 没有构建 web 产物，会把工作树里碰巧存在的 .next 打进去`).toContain("build:web");
      // 顺序也要对：构建必须在 electron-builder 之前，否则打进去的还是旧的
      expect(s.indexOf("build:web")).toBeLessThan(s.indexOf("electron-builder"));
    });
  }

  it("build:web 真的调 next build", () => {
    expect(pkg.scripts["build:web"]).toMatch(/next build/);
  });

  it("**端口不许硬编码在构建脚本里**——从 config 派生", () => {
    /*
      第一版我把 `NEXT_PUBLIC_API_URL=http://127.0.0.1:3200` 直接写进脚本，
      那就是本仓的头号病：同一个事实声明在两处（config.ts 的 `ports.api` 和这里），
      而它们漂移时的症状是**静默的**——页面正常打开、每个 API 请求打向旧地址。
      现在从 `local-runtime web-build-env` 取，两边不可能不一致。
    */
    const s = pkg.scripts["build:web"];
    expect(s, "build:web 里硬编码了端口").not.toMatch(/NEXT_PUBLIC_API_URL=https?:\/\/[^$\s]*\d{4}/);
    expect(s, "build:web 没有从 config 取构建期变量").toContain("web-build-env");
  });
});
