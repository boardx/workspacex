/**
 * 权限模型的实验性提示不进回喂给模型的 stderr，脚本自己的警告照留（#3872 R22）。
 *
 * 只有 Electron 自带的 Node 20 打这条（本地版）；Node 22（云端镜像、CI）不打，所以
 * 这里没法现场生成。夹具是安装版 `POST :3310/run` 实际返回的 stderr 原样字节
 * （2026-09-27，WorkspaceX 0.2.0 arm64，见 PR 正文），后面接一条脚本自己发的警告。
 */
import { describe, expect, it } from "vitest";
import { dropPermissionNotice, executeScript } from "../src/execute-script.js";

const realNotice =
  "(node:59278) ExperimentalWarning: Permission is an experimental feature and might change at any time\n" +
  "(Use `WorkspaceX --trace-warnings ...` to show where the warning was created)\n" +
  "(node:59278) ExperimentalWarning: from-script\n";

describe("权限提示过滤", () => {
  it("夹具确实含那条提示（否则下面的断言无从证伪）", () => {
    expect(realNotice).toMatch(/Permission is an experimental feature/);
  });

  it("去掉权限提示，留下脚本自己发的 ExperimentalWarning", () => {
    const out = dropPermissionNotice(realNotice);
    expect(out).not.toMatch(/Permission is an experimental feature/);
    expect(out).toMatch(/ExperimentalWarning: from-script/);
  });

  it("没有提示时原样返回", () => {
    expect(dropPermissionNotice("boom\n")).toBe("boom\n");
  });

  it("端到端：executeScript 的 stderr 里没有它", async () => {
    const r = await executeScript({ script: 'console.error("real-error")', timeoutMs: 20_000 });
    expect(r.stderr).toContain("real-error");
    expect(r.stderr).not.toMatch(/Permission is an experimental feature/);
  });
});
