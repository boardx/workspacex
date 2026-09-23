/**
 * 这道门控自己的门控：`lint-tailwind-color-tokens.mjs` 断的是「颜色类名对不对得上 token」，
 * 那它自己必须能**在假的坏输入上转红**——否则它只是一句写着「✅」的话。
 *
 * 用真实的 tailwind.config.ts 解析器 + 一份临时的坏组件，走 `scan()` 的真实路径。
 */
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error —— .mjs 无类型声明，这里只用它导出的两个纯函数。
import { colorNames, scan } from "./lint-tailwind-color-tokens.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const fakeRoot = (tsx: string): string => {
  const d = mkdtempSync(join(tmpdir(), "tw-tokens-"));
  dirs.push(d);
  cpSync(join(ROOT, "apps", "web", "tailwind.config.ts"), join(d, "tailwind.config.ts"));
  mkdirSync(join(d, "components"), { recursive: true });
  writeFileSync(join(d, "components", "x.tsx"), tsx, "utf8");
  return d;
};

describe("lint-tailwind-color-tokens", () => {
  it("真实配置里解析得出本仓的语义色，且不含 `danger` / 光秃秃的 `foreground`", () => {
    const names = colorNames(require("node:fs").readFileSync(join(ROOT, "apps/web/tailwind.config.ts"), "utf8")) as Set<string>;
    expect(names.has("destructive")).toBe(true);
    expect(names.has("muted-foreground")).toBe(true);
    expect(names.has("border-subtle")).toBe(true);
    // ⭐ 这两条是本轮那个 bug 的形状：写了没有的 token，Tailwind 静默不生成。
    expect(names.has("danger")).toBe(false);
    expect(names.has("foreground")).toBe(false);
  });

  it("坏输入转红：不存在的 token 被点名", () => {
    const hits = scan(fakeRoot('export const X = () => <p className="text-11 text-danger">坏</p>;')) as { cls: string }[];
    expect(hits.map((h) => h.cls)).toContain("text-danger");
  });

  it("好输入不误报：语义 token、内置关键字、单边边框色、ring 偏移色都放行", () => {
    const good = 'export const X = () => (<p className="text-center text-sm text-destructive border-dashed border-t-primary ring-offset-background bg-primary/10 text-muted-foreground">好</p>);';
    expect(scan(fakeRoot(good))).toEqual([]);
  });

  it("className 之外长得像工具类的东西不算（testid / 变量名）", () => {
    const noise = 'export const X = () => <p data-testid="fill-params-card" id="from-url">x</p>;';
    expect(scan(fakeRoot(noise))).toEqual([]);
  });

  /*
   * #3892：原来的扫描只看单行 `className="…"`，全仓 59 处 `text-foreground` 只数到 52 处。
   * 漏掉的正是下面这两种形状——而它们多半是 active/hover 态，也就是最该被看见的那几处。
   */
  it("跨行的 cn(…) 里的死类名也抓得到", () => {
    const tsx = [
      "export const X = ({ on }: { on: boolean }) => (",
      "  <p",
      "    className={cn(",
      '      "text-11",',
      '      on && "text-danger",',
      "    )}",
      "  >x</p>",
      ");",
    ].join("\n");
    const hits = scan(fakeRoot(tsx)) as { cls: string; line: number }[];
    // ⭐ 反证锚点：把扫描改回逐行 + 单行 `className="…"` ⇒ 这条红。
    expect(hits.map((h) => h.cls)).toEqual(["text-danger"]);
    expect(hits[0]!.line).toBe(5); // 行号落在字符串本身那一行，不是 className 那一行
  });

  it("className={…} 里三元两个分支的字符串都扫到", () => {
    const tsx = 'export const X = ({ on }: { on: boolean }) => <a className={on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-danger"}>x</a>;';
    expect((scan(fakeRoot(tsx)) as { cls: string }[]).map((h) => h.cls)).toEqual(["text-danger"]);
  });

  it("括号配对跳过字符串内部：字符串里的 `)` 不会把区域提前截断", () => {
    // `cn(…)` 单独赋值、不包在 `className={…}` 里——否则外层那个区域会兜住，测不出截断。
    const tsx = [
      'const cls = cn("text-11", "a)b", "text-danger");',
      "export const X = () => <p className={cls}>x</p>;",
    ].join("\n");
    // ⭐ 反证锚点：`balancedEnd` 不跳过字符串 ⇒ 区域在 `a)` 处提前结束，`text-danger` 漏掉 ⇒ 这条红。
    expect((scan(fakeRoot(tsx)) as { cls: string }[]).map((h) => h.cls)).toEqual(["text-danger"]);
  });
});
