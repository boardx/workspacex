/**
 * 2026-09-06 实测事故的**第二层**：改了 `deploy.sh` 并合入 main，对真正被执行的脚本
 * 没有任何影响——workflow 跑的是 `sudo /usr/local/bin/workspacex-deploy`（root 拥有的
 * 副本，sudoers 只许这一条路径），而那份副本只在有人以 root 跑 `provision.sh` 时更新。
 *
 * 实测形态：`up -d --build` 的修复合进 main、CI 全绿、deploy job success，而 devapp 上
 * 跑的仍是旧副本，沙箱镜像照旧没重建。绿得毫无破绽。
 *
 * 这里锁的就是这条缝：`deploy-gate.sh` 在把活交给那份副本之前，必须先逐字节确认
 * 「要跑的那份」就是本次提交里的那份，不一致**红退**（fail-closed），并打印重新
 * provision 的命令。
 *
 * ⚠ 门控刻意**不自动安装**新副本：runner 用户能改仓库文件，让它把仓库脚本装进
 *   /usr/local/bin 等于任何一个 PR 都能拿到 root。安装是人的动作，这一点不能优化掉。
 */
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const VM_DIR = resolve(import.meta.dirname);
const GATE = join(VM_DIR, "deploy-gate.sh");
const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

/**
 * 造一份「装好的副本」布局。`mutate` 用来制造漂移——不传就是与仓库逐字节一致。
 *
 * ⚠ 只调用 `assert_trusted_copies_match_repo` 本身，不跑 `deploy_gate_main`：后者会
 *   `sudo` 真去部署。测的是这道前置门，不是部署。
 */
function runDriftCheck(mutate?: (installedDeploy: string) => void): {
  status: number;
  stderr: string;
} {
  const temp = mkdtempSync(join(tmpdir(), "deploy-drift-"));
  temps.push(temp);
  const bin = join(temp, "workspacex-deploy");
  copyFileSync(join(VM_DIR, "deploy.sh"), bin);
  chmodSync(bin, 0o755);
  copyFileSync(join(VM_DIR, "deploy-readiness.sh"), join(temp, "workspacex-deploy-readiness.sh"));
  copyFileSync(join(VM_DIR, "deep-agent-lib.sh"), join(temp, "workspacex-deep-agent-lib.sh"));
  mutate?.(bin);

  const result = spawnSync(
    "bash",
    ["-c", `source ${JSON.stringify(GATE)}; assert_trusted_copies_match_repo`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TRUSTED_DEPLOY_BIN: bin,
        TRUSTED_LIB_DIR: temp,
      },
    },
  );
  return { status: result.status ?? -1, stderr: result.stderr };
}

describe("部署前先确认「要跑的那份脚本」就是本次提交里的那份", () => {
  it("三份都与仓库一致 ⇒ 放行", () => {
    const { status } = runDriftCheck();
    expect(status).toBe(0);
  });

  it("反证：装好的副本落后一版（正是本次事故的形态）⇒ 红退并说清怎么修", () => {
    const { status, stderr } = runDriftCheck((bin) => {
      // 模拟「main 上已经加了 --build，但机器上那份还没有」。
      const stale = readFileSync(bin, "utf8").replace(" up -d --build", " up -d");
      writeFileSync(bin, stale);
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("不是本次要部署的那份脚本");
    // 报错必须给出可执行的下一步，而不是只说「不一致」。
    expect(stderr).toContain("provision.sh");
  });

  it("反证：机器上压根没有那份副本 ⇒ 同样红退，不当成「一致」", () => {
    const { status, stderr } = runDriftCheck((bin) => rmSync(bin));
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/没有|provision/);
  });

  it("helper lib 漂移也算漂移（2026-08-11 栽过：只装 deploy.sh 不装 lib）", () => {
    const { status } = runDriftCheck(() => {
      const lib = join(temps[temps.length - 1]!, "workspacex-deep-agent-lib.sh");
      writeFileSync(lib, "# stale copy\n");
    });
    expect(status).not.toBe(0);
  });

  it("门控自己不许去装脚本——安装必须是人以 root 做的动作", () => {
    const gate = readFileSync(GATE, "utf8");
    const check = gate.slice(gate.indexOf("assert_trusted_copies_match_repo() {"));
    expect(check).not.toMatch(/\binstall\s+-o\s+root|cp\s+.*usr\/local\/bin/);
  });
});
