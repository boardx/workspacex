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
});
