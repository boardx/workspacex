/**
 * F979(design-delta skill-office-docs-node-runtime)—— L1 容器网络隔离,专门针对
 * 三个新增预装库(docx/exceljs/pdf-lib)。
 *
 * ⚠ 只写 V2-b 那一半(network:none 下确实连不通),**不**重复 `container-network-
 * isolation.test.ts` 已经建立的 V2-CP(同一装置在有网时确实连得通)——`network: none`
 * 是 Docker 的内核级网络命名空间隔离,发生在**任何 JS 代码跑起来之前**,与进程里
 * 加载了哪个 npm 包完全正交;V2-CP 那条"装置本身能连通"的反证已经被通用文件建立过
 * 一次,不需要为每个新库各自重新证明一遍"这套装置本身没坏"。这里唯一有新增价值的
 * 断言是:**三个新库一起被 require 之后**,network:none 依然生效——排除"某个库的
 * 原生扩展/子进程/共享库悄悄换了一条出网路径"这类小概率但真实存在的风险
 * (例如某些图像处理库会静态链接会自己发起 DNS 查询的原生代码)。docx/exceljs/
 * pdf-lib 三个都是纯 JS 实现(design-delta contract.md §2 明确选型依据之一就是
 * "纯 JS,不依赖原生扩展"),风险本身就低,但"低风险"不等于"不测"。
 *
 * 复用 `container-network-isolation.test.ts` 同一套镜像/伴生服务模式,不重新发明。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IMAGE = "workspacex-skill-sandbox:test";
const SUFFIX = `${process.pid}-${Date.now()}-office`;
const NETWORK = `wsx-sandbox-net-${SUFFIX}`;
const ECHO = `wsx-sandbox-echo-${SUFFIX}`;
const ECHO_BODY = "ECHO_FROM_COMPANION_OFFICE";

const TARGET_URL = `http://${ECHO}:8080/`;

/** 同时使用三个新库 + 尝试出网——证明"加载了这些库"不会打开一条新的出网路径。 */
const PROBE_SCRIPT = `
  const { Document } = require('docx');
  const ExcelJS = require('exceljs');
  const { PDFDocument } = require('pdf-lib');
  void new Document({ sections: [{ children: [] }] });
  void new ExcelJS.Workbook();
  PDFDocument.create().then(() => {
    fetch(${JSON.stringify(TARGET_URL)})
      .then((r) => r.text())
      .then((t) => console.log('NET_OK:' + t.trim()))
      .catch((e) => console.log('NET_BLOCKED:' + (e.cause ? e.cause.code || e.cause.message : e.message)));
  });
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

describeDocker("F979 V2-b(office libs):三库一起加载,network:none 依然连不通", () => {
  const created: string[] = [];

  beforeAll(async () => {
    await execFileAsync("docker", ["build", "-t", IMAGE, "."], {
      cwd: join(import.meta.dirname, ".."),
      timeout: 600_000,
    });
    await execFileAsync("docker", ["network", "create", NETWORK], { timeout: 60_000 });
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
    for (const name of created) {
      await execFileAsync("docker", ["rm", "-f", name], { timeout: 60_000 }).catch(() => undefined);
    }
    await execFileAsync("docker", ["network", "rm", NETWORK], { timeout: 60_000 }).catch(() => undefined);
  }, 300_000);

  it("docx + exceljs + pdf-lib all loaded, fetch from inside still fails under network:none", async () => {
    const name = `wsx-sandbox-office-isolated-${SUFFIX}`;
    await execFileAsync(
      "docker",
      [
        "run", "-d", "--name", name,
        "--network", "none",
        "--read-only",
        "--user", "node",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m,mode=1777",
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
    expect(result.stdout).toContain("NET_BLOCKED:");
    expect(result.stdout).not.toContain(ECHO_BODY);
    expect(result.stdout).not.toContain("NET_OK:");
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
        throw new Error(`sandbox container ${containerName} never became ready: ${(e as Error).message}\n${logs.stdout}${logs.stderr}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

interface RunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 在容器内调 `POST /run`(unix socket)—— 与 `container-network-isolation.test.ts`
 * 的 `postRun` 是**同一份实现**(照抄,不重新发明):脚本经 base64 走环境变量传入,
 * 避免多层 shell 引号转义把脚本改形。
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
