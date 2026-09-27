/**
 * 沙箱子进程必须以 Node 身份运行，哪怕 `nodeBinary` 是 Electron 本体（#3872 R21）。
 *
 * 替身照实机行为造：安装版里 Electron 本体在没有 ELECTRON_RUN_AS_NODE 时起 GUI，
 * 对脚本而言就是「退出码 0、stdout 空、没有文件」——正是那次实测看到的。
 * 有这个变量时它就是 Node。替身只复现这一个分叉，其余交给真 node。
 */
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";

function electronLikeBinary(): string {
  const dir = mkdtempSync(join(tmpdir(), "electron-like-"));
  const bin = join(dir, "WorkspaceX");
  writeFileSync(bin, `#!/bin/sh\n[ "$ELECTRON_RUN_AS_NODE" = "1" ] || exit 0\nexec "${process.execPath}" "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe.skipIf(process.platform === "win32")("Electron 本体当 nodeBinary", () => {
  it("脚本真的跑了：stdout 有输出", async () => {
    const r = await executeScript({ script: 'console.log("ran-as-node")', timeoutMs: 20_000, nodeBinary: electronLikeBinary() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ran-as-node");
  });
});
