/**
 * 起 tsx / next 用的入口必须是真文件，且与 node_modules 的布局无关（#4315）。
 * 写死 `apps/web/node_modules/next/...` 在 hoisted 布局（Windows 打包）下 MODULE_NOT_FOUND。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextLaunch, tsxLaunch } from "../src/node-launch";

const repoRoot = join(__dirname, "..", "..", "..");

describe("node-launch", () => {
  it("tsx 的入口解析到一个存在的文件，命令是当前 Node", () => {
    const l = tsxLaunch(repoRoot, ["x.ts"]);
    expect(l.command).toBe(process.execPath);
    expect(existsSync(l.args[0]!)).toBe(true);
    expect(l.args.slice(1)).toEqual(["x.ts"]);
  });

  it("next 的入口解析到一个存在的文件", () => {
    const l = nextLaunch(repoRoot, ["start"]);
    expect(existsSync(l.args[0]!)).toBe(true);
    expect(l.args[0]).toMatch(/next[\\/]dist[\\/]bin[\\/]next$/);
  });
});
