/**
 * issue #3428 系列（真实模型证据脚本那次已修：PR #3430）同一个缺陷形状，在
 * deploy.sh 里再审计一遍：写进 $ENV_FILE（deploy.env）之后会被下游
 * `source <(grep -v '^#' "$ENV_FILE")`（第 4b 步）当**普通 shell 脚本**执行。
 * 裸拼接 `echo "KEY=${value}"` 在值带空格时，会把 `=` 之后的内容拆成第二条要
 * 执行的命令，`source` 直接 `command not found` 崩掉。
 *
 * 审计结论（写在这里而不是只写在 PR 描述里，免得下次又要重新查一遍）：
 * ① KERNEL_SKILL_SANDBOX_SOCKET：值由 `$SANDBOX_SOCKET_DIR/skill-sandbox.sock` 拼成，
 *    SANDBOX_SOCKET_DIR 可被调用方经环境变量覆盖为任意路径——**有真实风险**，本文件
 *    锁定修法（`printf '%s=%q\n'`）与反证。
 * ② WORKSPACEX_OBJECT_ROOT：值是脚本内硬编码字面量 `/opt/workspacex/objects`，不经过
 *    任何外部输入——**无实际风险**，未改动，不在此文件断言。
 * ③ LANGSMITH_* 三件套：写进的是 `$DEEP_AGENT_ENV_FILE`（deep-agent.env），消费方是
 *    `docker run --env-file`——docker 的 env-file 语法按字面量整行取值，不做 shell
 *    重新解析，也不理解 `%q` 的反斜杠转义；对它加 `%q` 反而会把转义字符本身写进
 *    LangSmith 项目名——**不适用同一修法**，未改动。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const VM_DIR = resolve(import.meta.dirname);
const DEPLOY = readFileSync(join(VM_DIR, "deploy.sh"), "utf8");
const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

/**
 * 把「写 KERNEL_SKILL_SANDBOX_SOCKET」那一小段原样抽出来单独跑——锚点是脚本里
 * 逐字存在的两行，锚点漂了这里会找不到而红，不会静默测一份过时的副本。
 */
function extractSocketWriteSnippet(): string {
  const start = DEPLOY.indexOf('SANDBOX_SOCKET_PATH="$SANDBOX_SOCKET_DIR/skill-sandbox.sock"');
  const end = DEPLOY.indexOf("\nfi\n", start) + "\nfi".length;
  expect(start, "deploy.sh 里找不到 SANDBOX_SOCKET_PATH 写入段 —— 锚点漂了").toBeGreaterThan(-1);
  expect(end, "deploy.sh 里找不到该段的收尾 fi").toBeGreaterThan(start);
  return DEPLOY.slice(start, end);
}

function runSocketWrite(sandboxSocketDir: string, envFile: string) {
  return spawnSync(
    "bash",
    ["-euo", "pipefail", "-c", `SANDBOX_SOCKET_DIR=${JSON.stringify(sandboxSocketDir)}\nENV_FILE=${JSON.stringify(envFile)}\n${extractSocketWriteSnippet()}`],
    { encoding: "utf8" },
  );
}

describe("deploy.sh 写进 deploy.env 的 KERNEL_SKILL_SANDBOX_SOCKET 要能被安全 source", () => {
  it("SANDBOX_SOCKET_DIR 带空格时，写入不崩、且 source 原样还原", () => {
    const dir = mkdtempSync(join(tmpdir(), "deploy-sandbox-socket-"));
    temps.push(dir);
    const envFile = join(dir, "deploy.env");
    const socketDir = "/run/my sandbox dir"; // 空格：模拟调用方覆盖的自定义路径
    const expectedValue = `${socketDir}/skill-sandbox.sock`;

    const write = runSocketWrite(socketDir, envFile);
    expect(write.status, `write stderr:\n${write.stderr}`).toBe(0);

    const written = readFileSync(envFile, "utf8");
    expect(written).toMatch(/^KERNEL_SKILL_SANDBOX_SOCKET=/m);

    // 同 real-model-chat-evidence-env.test.ts 的手法：真的 source 产出的文件，
    // 不是重新实现一份解析逻辑去断言字符串形状。
    const sourceProbe = spawnSync(
      "bash",
      ["-c", 'set -eo pipefail; set -a; . "$1"; set +a; printf %s "$KERNEL_SKILL_SANDBOX_SOCKET"', "--", envFile],
      { encoding: "utf8" },
    );
    expect(sourceProbe.status, `source stderr:\n${sourceProbe.stderr}\nfile:\n${written}`).toBe(0);
    expect(sourceProbe.stdout).toBe(expectedValue);
  });

  it("幂等：已存在同名键时不重复写入（覆盖 %q 修法不破坏既有的去重逻辑）", () => {
    const dir = mkdtempSync(join(tmpdir(), "deploy-sandbox-socket-idem-"));
    temps.push(dir);
    const envFile = join(dir, "deploy.env");
    const socketDir = "/run/workspacex-sandbox";

    runSocketWrite(socketDir, envFile);
    const firstWrite = readFileSync(envFile, "utf8");
    runSocketWrite(socketDir, envFile);
    const secondWrite = readFileSync(envFile, "utf8");

    expect(secondWrite).toBe(firstWrite);
    expect(firstWrite.match(/^KERNEL_SKILL_SANDBOX_SOCKET=/gm)).toHaveLength(1);
  });

  it("反证：把修法换回旧的裸拼接写法，同一个 SANDBOX_SOCKET_DIR 会让 source 失败（锁定缺陷形状本身）", () => {
    const dir = mkdtempSync(join(tmpdir(), "deploy-sandbox-socket-oldshape-"));
    temps.push(dir);
    const envFile = join(dir, "deploy.env");
    const socketDir = "/run/my sandbox dir";

    const write = spawnSync(
      "bash",
      [
        "-c",
        'SANDBOX_SOCKET_PATH="$1/skill-sandbox.sock"; echo "KERNEL_SKILL_SANDBOX_SOCKET=${SANDBOX_SOCKET_PATH}" >> "$2"',
        "--",
        socketDir,
        envFile,
      ],
      { encoding: "utf8" },
    );
    expect(write.status).toBe(0);

    const sourceOld = spawnSync("bash", ["-c", 'set -eo pipefail; set -a; . "$1"; set +a', "--", envFile], {
      encoding: "utf8",
    });
    expect(sourceOld.status).not.toBe(0);
    expect(sourceOld.stderr).toContain("command not found");
  });
});
