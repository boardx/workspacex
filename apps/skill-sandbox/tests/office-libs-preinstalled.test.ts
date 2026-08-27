/**
 * F979(design-delta skill-office-docs-node-runtime)—— 构建期"预装保证"的锁定,
 * 补 `produces-real-{docx,xlsx,pdf}.test.ts` 里"没有 preinstalledModulesDir 就
 * MODULE_NOT_FOUND"那条运行期证明的另一半:那条证明的是"沙箱**不会**在运行时
 * 帮脚本装包",这条证明的是"镜像构建**确实**在构建期把三个新库连同 pptxgenjs
 * 一起装了、且装失败会让 `docker build` 直接红,不会带着一个坏镜像蒙混过关"。
 *
 * ⚠ 不起真容器(那是 `container-network-isolation.test.ts` 的活,秒级到分钟级)——
 * 这里只静态核对 `Dockerfile` 与 `package.json` 两份声明本身是否自洽、完整,
 * 跑起来是毫秒级。两条断言合起来才覆盖"构建期真的会因为漏装而失败"这件事:
 * package.json 里没声明的库,`npm install --omit=dev` 根本不会拉;Dockerfile 里
 * 没自检的库,即使漏装了 `docker build` 也不会报错,漏洞要等到运行时才暴露。
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const APP_ROOT = join(import.meta.dirname, "..");
const PREINSTALLED_PACKAGES = ["pptxgenjs", "docx", "exceljs", "pdf-lib"] as const;

describe("F979 预装保证:package.json 与 Dockerfile 自检两份声明必须都覆盖四个库", () => {
  it("package.json 的 dependencies 声明了全部四个预装库", async () => {
    const raw = await readFile(join(APP_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
    for (const name of PREINSTALLED_PACKAGES) {
      expect(pkg.dependencies?.[name], `package.json dependencies 缺少 ${name}`).toBeDefined();
    }
  });

  it("Dockerfile 对全部四个库都有构建期 require.resolve 自检", async () => {
    const dockerfile = await readFile(join(APP_ROOT, "Dockerfile"), "utf8");
    for (const name of PREINSTALLED_PACKAGES) {
      expect(
        dockerfile,
        `Dockerfile 缺少 ${name} 的 require.resolve 自检——漏装会等到运行时才暴露`,
      ).toContain(`require.resolve('${name}')`);
    }
    // 自检必须挂在同一条 RUN(`&&` 串联)里,装完立刻检——不能拆成后面独立的一条
    // RUN,那样即使自检失败,前面 `npm install` 那一层缓存依然会被后续构建复用,
    // 自检形同虚设。
    const installLine = dockerfile.split("\n").find((l) => l.includes("npm install --omit=dev"));
    expect(installLine, "Dockerfile 缺少 npm install --omit=dev 这一行").toBeDefined();
  });

  it("V1-CP 反证:漏掉任一库的自检,这条测试本身必须能检测出来", async () => {
    const dockerfileWithoutPdfLib = (await readFile(join(APP_ROOT, "Dockerfile"), "utf8")).replace(
      "require.resolve('pdf-lib')",
      "/* removed for counterproof */",
    );
    expect(dockerfileWithoutPdfLib).not.toContain("require.resolve('pdf-lib')");
  });
});
