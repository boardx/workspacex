/**
 * 把 pnpm 的软链式 `node_modules` 物化成一棵**扁平真实目录树**,供测试当作
 * `preinstalledModulesDir` 使用。
 *
 * ## 为什么需要这一步
 *
 * `execute-script.ts` 的 `moduleReadRoots` 头注写了完整推理:Node 权限模型不递归
 * 解析软链,而 pnpm 的 `node_modules/<pkg>` 是指向仓库根 `.pnpm/…` 的第二层软链,
 * 于是被执行的脚本 `require('pptxgenjs')` 必然 `ERR_ACCESS_DENIED`。
 *
 * **生产环境没有这个问题**——镜像里是 `npm install --omit=dev` 装出来的扁平真实
 * 目录树(见 Dockerfile)。所以这个文件是**测试夹具**,不是生产代码的一部分,
 * 也不是给生产打的补丁:它只是在开发机上重建出镜像里本来就有的那种布局。
 *
 * ⚠ 刻意放在 `tests/` 而不是 `src/`——同 `loopback-model-provider.ts` 的纪律:
 *   测试用的东西不进生产代码路径,生产代码里没有任何"如果是 pnpm 就……"的分支。
 *
 * 复制用 `cp -RL`(**解引用**软链)。源取 `.pnpm/<pkg>@<ver>/node_modules/`——
 * 那一层里既有包自己,也有它的全部直接依赖,正是解析需要的完整闭包。
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/**
 * ⚠ 末级目录名**必须**是 `node_modules`。包之间互相 `require` 时,Node 从包目录
 * 逐级上溯找 `node_modules`;若这棵树叫别的名字(早先那版叫 `.sandbox-modules`),
 * `pptxgenjs` 自己能解析到,但它 `require('jszip')` 时会一路上溯到**仓库的**
 * `apps/skill-sandbox/node_modules/jszip`——一个未授权的 pnpm 软链,于是又被拒。
 * 报错指向 jszip,看起来像"依赖没装全",实际是目录命名问题。
 */
const CACHE_DIR = join(APP_ROOT, ".sandbox-modules", "node_modules");

let cached: Promise<string> | undefined;

/**
 * 返回一棵扁平真实的 node_modules 路径,内含 `pptxgenjs` 及其直接依赖。
 * 进程内只物化一次(结果缓存)。
 */
export function flatModulesDir(): Promise<string> {
  cached ??= materialize();
  return cached;
}

/**
 * 把 `pptxgenjs` 的**传递闭包**摊平进一个目录。
 *
 * ⚠ 只复制一层闭包是不够的——已经栽过一次:pnpm 把每个包的直接依赖放在
 * **它自己那一版**的 `.pnpm/<pkg>@<ver>/node_modules/` 下,所以
 * `pptxgenjs → jszip → setimmediate` 这条链上,`setimmediate` 在
 * `.pnpm/jszip@<ver>/node_modules/` 里,不在 pptxgenjs 那一层。
 * 只拷 pptxgenjs 的闭包时,`setimmediate` 会一路上溯到仓库的 pnpm 软链而被拒。
 *
 * ⇒ 按包做 BFS:每复制一个包,就把**它所在的那个** node_modules 里的同级条目
 *   全部入队,直到没有新包。摊平之后所有包互为同级,解析一次就命中。
 */
async function materialize(): Promise<string> {
  const marker = join(CACHE_DIR, "pptxgenjs", "package.json");
  if (await exists(marker)) return CACHE_DIR;

  await rm(dirname(CACHE_DIR), { recursive: true, force: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const queue = [await realpath(join(APP_ROOT, "node_modules", "pptxgenjs"))];
  const copied = new Set<string>();

  while (queue.length > 0) {
    const pkgReal = queue.shift()!;
    // `.pnpm/<pkg>@<ver>/node_modules/<name>` 与 `@scope/<name>` 两种形态都靠
    // package.json 里的 name 定名,不去解析目录名。
    const name = await packageName(pkgReal);
    if (name === undefined || copied.has(name)) continue;
    copied.add(name);

    const dest = join(CACHE_DIR, name);
    await mkdir(dirname(dest), { recursive: true });
    // -L 解引用:结果里不再有任何软链,这正是权限模型能接受的形态。
    await execFileAsync("cp", ["-RL", pkgReal, dest]);

    // 该包的依赖 = 它所在的那个 node_modules 目录里的同级条目。
    const siblingRoot = dirname(pkgReal);
    for (const entry of await readdir(siblingRoot, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const child = join(siblingRoot, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of await readdir(child, { withFileTypes: true })) {
          queue.push(await realpath(join(child, scoped.name)));
        }
        continue;
      }
      queue.push(await realpath(child));
    }
  }

  if (!(await exists(marker))) {
    throw new Error(`flat module materialization failed: ${marker} is missing after copy`);
  }
  return CACHE_DIR;
}

async function packageName(pkgDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(pkgDir, "package.json"), "utf8");
    const name = (JSON.parse(raw) as { name?: unknown }).name;
    return typeof name === "string" && name !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
