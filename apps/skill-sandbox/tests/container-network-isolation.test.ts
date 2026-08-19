/**
 * `verification.md` **V2-b**（contract §4 的 L1 容器层，全套里最关键的一条）
 * 与它的反证 **V2-CP**。
 *
 * ## 这条测的到底是什么
 *
 * V2-b：在 `network: none` 的真容器里执行一个 `fetch(...)` 的脚本，**必须失败**。
 * V2-CP：**同一个脚本、同一个镜像、同一套断言**，只把 `--network none` 换成
 *        接入一个有伴生 HTTP 服务的 docker 网络 ⇒ 那个 fetch **必须成功**。
 *
 * ⚠ V2-CP 才是让 V2-b 有意义的那一半。没有它，一条"fetch 失败"的断言可能只是因为
 *   地址本来就不通、DNS 本来就解析不了、或者脚本压根没跑起来 —— 那样的绿是假绿。
 *   V2-CP 证明：这套装置在有网时**确实能连通**，所以 V2-b 的红是网络被关掉造成的，
 *   不是别的原因。
 *
 * ⚠⚠ 如果哪天 V2-b 变红，正确的处理是**去查 network: none 是不是被摘了**，
 *   而不是放宽断言或"给它开一点网"。后者是把门控调成不会红（本仓九次事故的同一形状）。
 *
 * ## 为什么用伴生容器而不是公网地址
 *
 * 打公网（example.com / 1.1.1.1）会让这条门控依赖 CI 的出网能力：离线环境里
 * V2-b 会"因为没网"而绿 —— 那是**假绿**，它没有证明 `network: none` 起了作用。
 * 伴生容器让两种情形都在同一台机器上确定性可复现，不需要任何外网。
 *
 * ## 为什么提交任务走 `docker exec` 而不是从宿主连 unix socket
 *
 * 生产形态是「apps/api 容器 ←→ 沙箱容器」经**共享的具名 volume** 上的 unix socket
 * 通信（见 docker-compose.sandbox.yml），两端都在 Linux 侧，正常工作。
 *
 * 但**测试跑在 macOS 宿主上**：Docker Desktop 的 virtiofs bind mount **不会**把
 * unix socket 节点透传到宿主，容器里 listen 成功、宿主侧 `connect ENOENT`（#1583 实测）。
 * ⇒ 这里改成在容器内 `docker exec` 一个客户端去连本地 socket。
 *
 * ⚠ 这只改变了「怎么把任务递进去」，**没有**改变被测的东西：断言依然是
 *   *被执行的脚本* 能不能出网。递送通道不参与断言。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IMAGE = "workspacex-skill-sandbox:test";
const SUFFIX = `${process.pid}-${Date.now()}`;
const NETWORK = `wsx-sandbox-net-${SUFFIX}`;
const ECHO = `wsx-sandbox-echo-${SUFFIX}`;
const ECHO_BODY = "ECHO_FROM_COMPANION";

/** 伴生服务在容器网络里的地址。V2-b 里它不可达，V2-CP 里它可达。 */
const TARGET_URL = `http://${ECHO}:8080/`;

const PROBE_SCRIPT = `
  fetch(${JSON.stringify(TARGET_URL)})
    .then((r) => r.text())
    .then((t) => console.log('NET_OK:' + t.trim()))
    .catch((e) => console.log('NET_BLOCKED:' + (e.cause ? e.cause.code || e.cause.message : e.message)));
`;

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info"], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

const HAS_DOCKER = await dockerAvailable();
const describeDocker = HAS_DOCKER ? describe : describe.skip;

describeDocker("V2-b / V2-CP 容器网络隔离", () => {
  const created: string[] = [];

  beforeAll(async () => {
    await execFileAsync("docker", ["build", "-t", IMAGE, "."], {
      cwd: join(import.meta.dirname, ".."),
      timeout: 600_000,
    });

    await execFileAsync("docker", ["network", "create", NETWORK], { timeout: 60_000 });
    // 伴生 HTTP 服务：只在容器网络里，不占宿主端口。
    await execFileAsync(
      "docker",
      [
        "run", "-d", "--name", ECHO, "--network", NETWORK, "node:22-slim",
        "node", "-e",
        `require('http').createServer((q,s)=>s.end(${JSON.stringify(ECHO_BODY)})).listen(8080)`,
      ],
      { timeout: 300_000 },
    );
    created.push(ECHO);
  }, 900_000);

  afterAll(async () => {
    // ⚠ 主动清理：孤儿容器/网络会占住准入槽卡住别的 agent（本仓已有事故记录）。
    for (const name of created) {
      await execFileAsync("docker", ["rm", "-f", name], { timeout: 60_000 }).catch(() => undefined);
    }
    await execFileAsync("docker", ["network", "rm", NETWORK], { timeout: 60_000 }).catch(
      () => undefined,
    );
  }, 300_000);

  /**
   * 起一个沙箱服务容器，通过 bind-mount 的 unix socket 提交脚本，回执行结果。
   * `networkArgs` 是本文件唯一的变量 —— V2-b 与 V2-CP 的差别**只有它**。
   */
  async function runProbeWith(networkArgs: readonly string[], label: string): Promise<string> {
    const name = `wsx-sandbox-${label}-${SUFFIX}`;

    await execFileAsync(
      "docker",
      [
        "run", "-d", "--name", name,
        ...networkArgs,
        // 与 docker-compose.sandbox.yml 同一组 L1 参数。
        "--read-only",
        "--user", "node",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m,mode=1777",
        // socket 放 tmpfs 上，容器内自足，不经宿主文件系统。
        "--tmpfs", "/run/sandbox:rw,noexec,nosuid,size=8m,mode=0770,uid=1000,gid=1000",
        "--memory", "1g",
        "--pids-limit", "128",
        "-e", "SKILL_SANDBOX_SOCKET=/run/sandbox/skill-sandbox.sock",
        "-e", "SKILL_SANDBOX_MODULES_DIR=/opt/sandbox/node_modules",
        IMAGE,
      ],
      { timeout: 300_000 },
    );
    created.push(name);

    await waitForReady(name);
    const result = await postRun(name, PROBE_SCRIPT);
    expect(result.exitCode, `sandbox stderr:\n${result.stderr}`).toBe(0);
    return result.stdout;
  }

  it("V2-b: a script inside a network:none container CANNOT reach the network", async () => {
    const stdout = await runProbeWith(["--network", "none"], "isolated");

    expect(stdout).toContain("NET_BLOCKED:");
    // 断言得到的**不是**伴生服务的响应体 —— 直接钉死"确实没连上"。
    expect(stdout).not.toContain(ECHO_BODY);
    expect(stdout).not.toContain("NET_OK:");
  }, 900_000);

  it("V2-CP: the same probe DOES reach it once network:none is removed — so V2-b really tests the network", async () => {
    const stdout = await runProbeWith(["--network", NETWORK], "networked");

    // 这一条绿 ⇒ 装置本身能连通 ⇒ 上一条的红是 network:none 造成的，不是环境噪声。
    expect(stdout).toContain("NET_OK:");
    expect(stdout).toContain(ECHO_BODY);
  }, 900_000);
});

async function waitForReady(containerName: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      await postRun(containerName, "console.log('ready')");
      return;
    } catch (e) {
      if (Date.now() > deadline) {
        const logs = await execFileAsync("docker", ["logs", containerName]).catch(() => ({
          stdout: "",
          stderr: "<no logs>",
        }));
        throw new Error(
          `sandbox socket never became ready: ${String(e)}\ncontainer logs:\n${logs.stdout}\n${logs.stderr}`,
        );
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

interface RunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 在容器内调 `POST /run`（unix socket）—— 与生产里 `HttpSkillSandbox` 走的是同一条路，
 * 只是客户端跑在容器里（理由见文件头）。
 *
 * 脚本经 base64 走环境变量传入，避免多层 shell 引号转义把脚本改形 —— 那会让
 * 一条本该测网络的断言，变成在测我们的转义写对没有。
 */
async function postRun(containerName: string, script: string): Promise<RunResult> {
  const client = `
    const http = require('http');
    const script = Buffer.from(process.env.PROBE_B64, 'base64').toString('utf8');
    const payload = JSON.stringify({ script, timeoutMs: 30000 });
    const req = http.request({
      socketPath: process.env.SKILL_SANDBOX_SOCKET, path: '/run', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { console.error('STATUS ' + res.statusCode + ' ' + body); process.exit(9); }
        process.stdout.write(body);
      });
    });
    req.on('error', (e) => { console.error(e.message); process.exit(8); });
    req.end(payload);
  `;

  const { stdout } = await execFileAsync(
    "docker",
    [
      "exec",
      "-e", `PROBE_B64=${Buffer.from(script, "utf8").toString("base64")}`,
      containerName,
      "node", "-e", client,
    ],
    { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as RunResult;
}
