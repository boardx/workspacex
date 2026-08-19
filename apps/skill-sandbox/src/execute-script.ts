/**
 * 沙箱执行核心（contract §4 的 **L2 进程层**）。
 *
 * ## 这一层挡什么、不挡什么——请先读这段再改任何一行
 *
 * 本文件用 `node --experimental-permission --allow-fs-read=<workdir>
 * --allow-fs-write=<outdir>` 起子进程，**不给** `--allow-child-process` /
 * `--allow-worker`。它挡住的是：文件越界读、文件越界写、起子进程。
 *
 * ⚠⚠ **它挡不住网络。** 这不是待修的疏漏，是 Node 权限模型的设计边界——它没有网络
 * 维度。实测（#1575 ⑤，并于 #1583 在 Node v22.23.1 上独立重跑确认）：在开满上述全部
 * 权限限制的进程里，`fetch('https://example.com')` 照样返回 **200**。
 *
 * ⇒ 网络**只能**由 contract §4 的 **L1 容器层**（`network: none`）关掉。
 *   两层各挡各的，互不替代，任何一层被摘掉都算回归（`verification.md` V2-a / V2-b
 *   各锁一层，V2-CP 是 V2-b 的反证）。
 *
 * ⚠ 因此：**不要**因为「V2-b 在本机裸跑时是绿的/红的」就来改这个文件的权限旗标。
 *   V2-b 测的是容器网络，不是进程权限；想让它变绿的唯一正当修法是真的关掉网络。
 *
 * ## 为什么是 spawn 一个新进程，而不是 vm / worker_threads
 *
 * `--experimental-permission` 是**进程级**旗标，只能在进程启动时给。`vm` 模块从来
 * 不是安全边界（Node 官方文档自己写着不要拿它当沙箱），`worker_threads` 与主进程
 * 共享权限集。所以唯一能真的挂上 L2 的形态就是 spawn 一个带旗标的新 node 进程。
 *
 * ## 超时是 wall-clock 硬超时，且杀进程组
 *
 * 脚本可能在 CPU 死循环里（V4 的 `SANDBOX_TIMEOUT` 就是这么触发的），此时没有任何
 * 事件循环回调会跑，靠 JS 内部的定时器自省是不可能的。所以超时判定放在**父进程**，
 * 到点 `SIGKILL`（不是 SIGTERM——死循环不会响应可捕获信号）。
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 回喂给模型的 stdout/stderr 上限——contract §7 要求「截断后的 stdout/stderr」。 */
export const OUTPUT_CAPTURE_LIMIT_BYTES = 64 * 1024;

/** 单个产物大小上限，防止一个脚本写出 GB 级文件把 tmpfs 撑爆。 */
export const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export interface SandboxFile {
  readonly name: string;
  /** base64——`POST /run` 是 JSON 契约，二进制只能这么过。 */
  readonly contentBase64: string;
  readonly sizeBytes: number;
}

export interface ExecuteScriptResult {
  /** 被信号杀死时为 null（`timedOut` 会同时为 true）。 */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly files: readonly SandboxFile[];
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface ExecuteScriptOptions {
  readonly script: string;
  readonly timeoutMs: number;
  /** 测试注入；生产用 `process.execPath`。 */
  readonly nodeBinary?: string;
  /**
   * 预装依赖所在的 node_modules 目录。⚠ **只读授权**——脚本可以 `require('pptxgenjs')`，
   * 但不能往里写。skill 原文写着「preinstalled — do not run `npm install` first」，
   * 且 `network: none` 下容器本就装不了包，二者自洽（contract §4 末尾）。
   */
  readonly preinstalledModulesDir?: string;
}

/** 截断到字节上限，并明确告诉模型「这里被截断了」——不假装输出就这么长。 */
function truncate(buffers: readonly Buffer[]): string {
  const joined = Buffer.concat(buffers);
  if (joined.length <= OUTPUT_CAPTURE_LIMIT_BYTES) return joined.toString("utf8");
  const head = joined.subarray(0, OUTPUT_CAPTURE_LIMIT_BYTES).toString("utf8");
  return `${head}\n...[truncated ${joined.length - OUTPUT_CAPTURE_LIMIT_BYTES} bytes]`;
}

export async function executeScript(options: ExecuteScriptOptions): Promise<ExecuteScriptResult> {
  /**
   * ⚠ `realpath` 不是可有可无的整洁措施。Node 权限模型按**真实路径**判定,而
   * `os.tmpdir()` 在 macOS 上返回 `/var/folders/...`,`/var` 是指向 `/private/var`
   * 的符号链接。用未解析的路径授权时,子进程连自己的入口脚本都加载不了——
   * 实测报错是 `ERR_ACCESS_DENIED { permission: 'FileSystemRead', resource: '/var' }`,
   * 发生在 `resolveMainPath` 里,脚本一行都没跑到,stdout 全空。
   *
   * 这个坑在 Linux 容器里(`/tmp` 是真目录)不会出现,所以**只在开发机上会红**——
   * 正因如此更要在这里解决,而不是等哪天有人在 mac 上看到一片空 stdout 去怀疑
   * 自己的脚本。
   */
  const root = await realpath(await mkdtemp(join(tmpdir(), "skill-sandbox-")));
  const workdir = join(root, "work");
  const outdir = join(workdir, "out");
  await mkdir(outdir, { recursive: true });

  /**
   * CommonJS,不是 ESM。两个理由:
   * ① pptx skill 原文给的脚本用的是 `require('pptxgenjs')`;
   * ② `NODE_PATH` 只对 CommonJS 解析生效,对 ESM 完全无效——早先那版把脚本写成
   *    `.mjs` 并指望 `NODE_PATH` 能让 `require` 找到预装依赖,是**两处同时错**
   *    (`.mjs` 里根本没有 `require`)。现在改成:显式 `package.json` 钉死
   *    `"type":"commonjs"`(不让 Node 往上游目录找到别人的 package.json 而误判),
   *    并在 workdir 下软链一个 `node_modules` 指向预装目录,走 Node 正常的
   *    逐级上溯解析,不依赖任何环境变量。
   */
  await writeFile(join(workdir, "package.json"), JSON.stringify({ type: "commonjs" }), "utf8");
  if (options.preinstalledModulesDir) {
    await symlink(options.preinstalledModulesDir, join(workdir, "node_modules"), "dir");
  }

  const scriptPath = join(workdir, "script.js");
  await writeFile(scriptPath, options.script, "utf8");

  const startedAt = Date.now();
  try {
    return await runOnce(options, { root, workdir, outdir, scriptPath, startedAt });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

interface Paths {
  readonly root: string;
  readonly workdir: string;
  readonly outdir: string;
  readonly scriptPath: string;
  readonly startedAt: number;
}

async function runOnce(options: ExecuteScriptOptions, paths: Paths): Promise<ExecuteScriptResult> {
  const readPaths = [paths.workdir, ...(await moduleReadRoots(options.preinstalledModulesDir))];

  const args = [
    "--experimental-permission",
    /**
     * ⚠ **每个路径一个独立的 `--allow-fs-read`,不要合并成逗号分隔的一个。**
     *
     * 实测(#1583,Node v22.23.1):`--allow-fs-read=a,b` **不会**被拆成两个路径。
     * 同一组路径,写成一个逗号分隔的旗标时连第一步模块解析都过不去;拆成两个
     * 旗标时正常推进。两种写法的报错还不一样(前者停在入口,后者停在某个具体
     * 依赖上),很容易被误读成"是依赖装漏了",从而去改 package.json 而不是改这里。
     */
    ...readPaths.map((p) => `--allow-fs-read=${p}`),
    `--allow-fs-write=${paths.outdir}`,
    // ⚠ 刻意**不给** --allow-child-process / --allow-worker。别"顺手"加上：
    //   V2-a 的三条断言里有一条就钉着 child_process 必须 ERR_ACCESS_DENIED。
    paths.scriptPath,
  ];

  const child = spawn(options.nodeBinary ?? process.execPath, args, {
    cwd: paths.outdir,
    // 干净环境：不把宿主进程的 env（可能含凭据）泄进被执行的脚本里。
    env: {
      SKILL_SANDBOX_OUT_DIR: paths.outdir,
      PATH: "/usr/bin:/bin",
    },
    stdio: ["ignore", "pipe", "pipe"],
    // 自成进程组，超时时可以整组杀掉，不给"起了孙进程就杀不干净"留缝。
    detached: true,
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // SIGKILL 而不是 SIGTERM：CPU 死循环不会响应可捕获信号。
    // 负号 = 杀整个进程组。
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, options.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  }).finally(() => clearTimeout(timer));

  const files = timedOut ? [] : await collectFiles(paths.outdir);

  return {
    exitCode,
    stdout: truncate(stdoutChunks),
    stderr: truncate(stderrChunks),
    files,
    timedOut,
    durationMs: Date.now() - paths.startedAt,
  };
}

/**
 * 预装依赖需要授权的**真实**读路径。
 *
 * ## ⚠ `preinstalledModulesDir` 必须是一棵**扁平的真实目录树**
 *
 * 也就是 `npm install --omit=dev` 装出来的那种:每个包都是真目录,不是软链。
 * 镜像里就是这么装的(见 Dockerfile);pnpm 工作区**不是**这种布局,所以测试要先
 * 物化一份扁平副本(`tests/support/flat-modules.ts`)。
 *
 * 这条要求不是洁癖,是实测(#1583)出来的硬边界:Node 权限模型**不递归解析软链**。
 * 一层软链没问题(我们自己在 workdir 下建的那个 `node_modules` 软链就正常工作);
 * 但 pnpm 的 `node_modules/<pkg>` 是**第二层**软链(指向仓库根的
 * `.pnpm/<pkg>@<ver>/node_modules/<pkg>`),这时即使把链条上每一段的真实路径
 * **全部**显式授权,依然会被拒:
 *
 * ```
 * ERR_ACCESS_DENIED  permission: 'FileSystemRead'
 * resource: '…/work/node_modules/pptxgenjs/package.json'
 * ```
 *
 * ⚠ 注意这个报错的误导性:它报的是**请求路径**,那个路径明明在已授权的 workdir
 *   里面,看上去像"授权没生效"。真正的原因是它解析到的目标不在授权集合里,
 *   而且再怎么加授权也没用——所以正确的修法是**改目录布局**,不是继续加授权。
 *   已经在这里栽过两次,别再往这个函数里堆路径了。
 *
 * ⚠ 这是**只读**授权。可写的始终只有 `outdir` 一个目录。
 */
async function moduleReadRoots(modulesDir: string | undefined): Promise<readonly string[]> {
  if (!modulesDir) return [];
  return [await realpath(modulesDir)];
}

/**
 * 只收 `outdir` 一层下的普通文件。刻意不递归、不跟随符号链接：
 * 产物是"脚本写出来的 deck"，不是一棵任意目录树；递归收集会把一个恶意脚本
 * 造出来的深层结构原样搬进 ObjectStore。
 */
async function collectFiles(outdir: string): Promise<readonly SandboxFile[]> {
  const entries = await readdir(outdir, { withFileTypes: true });
  const files: SandboxFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const bytes = await readFile(join(outdir, entry.name));
    if (bytes.length > MAX_ARTIFACT_BYTES) continue;
    files.push({
      name: entry.name,
      contentBase64: bytes.toString("base64"),
      sizeBytes: bytes.length,
    });
  }
  return files;
}
