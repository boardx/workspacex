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
 *
 * ## ⚠ F979:每个进程建自己私有的一份,不跨进程共享——这是踩过两轮真实竞态后的结论
 *
 * 早先两版都想让多个 vitest 进程共享同一个磁盘上的 `CACHE_DIR`(先是直接
 * rm+mkdir+cp,后来改成"建到独立临时目录再整体 rename 过去",最后又改成"符号链接
 * 原子切换"),每一版都踩到一个新的真实竞态或权限模型限制:
 *
 * 1. 直接对同一路径 rm+mkdir+cp:多进程并发时出现 `cp: File exists` / `ENOTEMPTY`。
 * 2. 建到独立目录再 `rm(parent) → rename(staging, parent)`:这两步之间有一个
 *    `CACHE_DIR` 在磁盘上**完全不存在**的窗口,另一个正在跑的沙箱脚本此时
 *    `require('docx')` 会拿到 `MODULE_NOT_FOUND`——不是没装,是发布过程本身的真空。
 * 3. 把 `.sandbox-modules` 做成指向真实目录的符号链接、用 `rename()` 原子切换
 *    符号链接本身:**这次不是竞态,是 Node 权限模型的硬限制**——
 *    `--experimental-permission` 下 Node 解析 `workdir/node_modules/docx` 这条路径时,
 *    要经过 `.sandbox-modules` 这一层符号链接本身,而 `realpathSync` 这一步对
 *    **符号链接这个目录项自身**也要过权限检查,我们只对它解出来的最终真实路径
 *    做了 `--allow-fs-read`,没有也没法覆盖"这一层符号链接"这个中间产物——实测
 *    报错 `resource: '.../.sandbox-modules'`(不是 node_modules 下面的任何东西,
 *    就是符号链接自己)。
 *
 * ⇒ 干脆放弃"多进程共享一份"这个目标:每个调用 `flatModulesDir()` 的进程各自建
 *   一份完全独立、路径带 `pid + uuid` 的真实目录树,永远不会跟别的进程撞名字,
 *   也就没有任何需要跨进程协调的窗口。代价只是"温度"不共享——vitest 默认按文件
 *   开独立 worker,原本能省的重复拷贝现在省不掉了,实测每次全新拷贝 ~3s,一次
 *   测试运行里最多付出几次 × 3s,换来的是**没有任何竞态类别**,而不是"又修好一种
 *   新竞态,换来第四种"。进程内仍然缓存(`cached`),同一 worker 里的多个 test 不
 *   会重复建。进程退出时尽力清理自己建的目录(`process.once("exit", …)`),清理
 *   失败也没关系——只是磁盘占用,不影响正确性。
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let cached: Promise<string> | undefined;

/**
 * 返回一棵扁平真实的 node_modules 路径,内含四个预装 skill 库
 * (`pptxgenjs`/`docx`/`exceljs`/`pdf-lib`,F979 新增后三个)及其各自的传递依赖。
 * 进程内只物化一次(结果缓存),不与其它进程共享(见文件头注)。
 */
export function flatModulesDir(): Promise<string> {
  cached ??= materialize();
  return cached;
}

const PREINSTALLED_PACKAGES = ["pptxgenjs", "docx", "exceljs", "pdf-lib"] as const;

/**
 * 把预装库们各自的**传递闭包**摊平进同一个目录。
 *
 * ⚠ 只复制一层闭包是不够的——已经栽过一次:pnpm 把每个包的直接依赖放在
 * **它自己那一版**的 `.pnpm/<pkg>@<ver>/node_modules/` 下,所以
 * `pptxgenjs → jszip → setimmediate` 这条链上,`setimmediate` 在
 * `.pnpm/jszip@<ver>/node_modules/` 里,不在 pptxgenjs 那一层。
 * 只拷 pptxgenjs 的闭包时,`setimmediate` 会一路上溯到仓库的 pnpm 软链而被拒。
 *
 * ⇒ 按包做 BFS:每复制一个包,就把**它所在的那个** node_modules 里的同级条目
 *   全部入队,直到没有新包。摊平之后所有包互为同级,解析一次就命中。
 *
 * ⚠ F979 真实踩到的坑:**同名不同版本**的包会被"先到先得"式地按名字去重,丢弃
 * 后来者——真实发生过:exceljs 自己直接依赖 `readable-stream@3.6.2`,但它的传递
 * 依赖 `archiver → lazystream` 需要的是 `readable-stream@2.x`(v3 把
 * `passthrough.js`/`transform.js`/`duplex.js` 等顶层文件挪进了 `lib/`,v2 没挪)。
 * BFS 先碰到 v3(exceljs 自己的直接依赖),按名字把它摊平到顶层,后碰到的 v2 因为
 * 同名被跳过——于是 `lazystream` 执行时 `require('readable-stream/passthrough')`
 * 在摊平树里根本找不到那个文件,Node 的解析算法转而向**摊平树外面**的目录继续找
 * (排列在 `_nodeModulePaths` 更靠外层的候选),一路找到仓库真实的 `node_modules`,
 * 权限模型在那一步才因越界读被拒——报错落在一个看起来无关的 `package.json` 上,
 * 很容易被误判成"这个包压根没装"。
 *
 * pnpm 的虚拟 store 天生允许同名多版本共存;这里手工摊平时必须自己重建同一能力
 * ——照抄 npm 真实的冲突解决方式:**版本相同就复用一份;版本不同就嵌套进"请求方
 * 自己那份"的 `node_modules/` 里**(而不是继续摊平到顶层),这样两个版本都各自
 * 从离自己最近的 `node_modules` 解析到,互不覆盖。
 */
interface QueueItem {
  readonly pkgReal: string;
  /** 发现这个包的那个"请求方"包最终被摆到的 destDir——版本冲突时,新版本要嵌套
   *  进**这个目录**自己的 `node_modules/` 下(不是嵌套进全局摊平根,那样等于没
   *  嵌套,两个版本还是会撞在同一路径上)。顶层四个种子没有请求方,用摊平根占位
   *  ——它们四个互相不会撞名,这个分支不会被触发。 */
  readonly parentDestDir: string;
}

async function materialize(): Promise<string> {
  const root = `${join(APP_ROOT, ".sandbox-modules")}-real-${process.pid}-${randomUUID()}`;
  const flatDir = join(root, "node_modules");
  await mkdir(flatDir, { recursive: true });

  // 进程退出时尽力清理——失败也没关系,只是磁盘占用,不影响正确性,也不会跟任何
  // 别的进程竞争(每个进程的目录名都带自己的 pid + uuid,互不相干)。
  process.once("exit", () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* 尽力而为 */
    }
  });

  const queue: QueueItem[] = await Promise.all(
    PREINSTALLED_PACKAGES.map(async (pkg) => ({
      pkgReal: await realpath(join(APP_ROOT, "node_modules", pkg)),
      parentDestDir: flatDir,
    })),
  );
  /** name → 已经摊平到某个 node_modules 下的那一份的 {version, destDir}。 */
  const placedByName = new Map<string, { readonly version: string; readonly destDir: string }>();
  /** destDir(已实际 cp 过的目标路径)去重,防止同一嵌套目标被排队两次时重复拷贝。 */
  const copiedDestDirs = new Set<string>();

  while (queue.length > 0) {
    const { pkgReal, parentDestDir } = queue.shift()!;
    // `.pnpm/<pkg>@<ver>/node_modules/<name>` 与 `@scope/<name>` 两种形态都靠
    // package.json 里的 name/version 定名,不去解析目录名。
    const meta = await packageMeta(pkgReal);
    if (meta === undefined) continue;
    const { name, version } = meta;

    const existing = placedByName.get(name);
    let destDir: string;
    if (existing === undefined) {
      destDir = join(flatDir, name);
      placedByName.set(name, { version, destDir });
    } else if (existing.version === version) {
      // 同名同版本,已经在别处摊平过、依赖闭包也已经走过 BFS——直接复用,不用再拷贝。
      continue;
    } else {
      // 同名不同版本:嵌套进"请求方自己那份"(parentDestDir)的 node_modules 下,
      // 不再往顶层摊平——这样 Node 从请求方文件出发逐级上溯时,先撞见的是嵌套的
      // 这一份,顶层那份留给其余按名字解析的请求方,两者互不覆盖。
      destDir = join(parentDestDir, "node_modules", name);
    }

    if (copiedDestDirs.has(destDir)) continue;
    copiedDestDirs.add(destDir);

    await mkdir(dirname(destDir), { recursive: true });
    // -L 解引用:结果里不再有任何软链,这正是权限模型能接受的形态。
    await execFileAsync("cp", ["-RL", pkgReal, destDir]);

    // 该包的依赖 = 它所在的那个 node_modules 目录里的同级条目。子依赖默认都排队
    // 去顶层摊平(大多数包不冲突,继续保持扁平,解析成本最低);只有子依赖自己的
    // 名字在别处已经被别的版本占了,上面的分支才会把它摁进当前这个 destDir 自己
    // 的 node_modules——所以这里把 `destDir` 作为子依赖的 parentDestDir 传下去。
    // ⚠ F979 真实踩到的坑:scoped 包(`@fast-csv/format`)物理上多套一层 `@scope/`
    // 目录,`dirname(pkgReal)` 只到得了 scope 目录本身(此例里只看到 `format` 一个
    // "同级"),够不到真正的 node_modules 层——于是 `@fast-csv/format` 自己的一批
    // 直接依赖(`lodash.isfunction`/`lodash.isequal`/… 五个包)被整体漏掉,报错
    // 却指向看似无关的 `lodash.isfunction`,容易被误判成"这个包没装"。
    // 修法:scoped 包(name 以 `@` 开头)要多上溯一级。
    const siblingRoot = name.startsWith("@") ? dirname(dirname(pkgReal)) : dirname(pkgReal);
    for (const entry of await readdir(siblingRoot, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const child = join(siblingRoot, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of await readdir(child, { withFileTypes: true })) {
          const scopedReal = await realpath(join(child, scoped.name));
          // ⚠ F979 真实踩到的另一个坑,实测才发现:pnpm 会在每个包**自己那份**
          // `.pnpm/<pkg>@<ver>/node_modules/` 里放一个指回自己的真实同名目录
          // (不是软链,是 pnpm 自解析用的真目录),让包在需要"引用自己名字"时能就地
          // 解析到。BFS 把这当成普通同级依赖入队,遇到版本冲突走"嵌套"分支时,
          // 这个自引用条目会被嵌套进刚建好的目标目录自己的 node_modules 下,而它的
          // "同级"里又包含同一个自引用条目——于是每一轮都在刚生成的嵌套目录下面
          // 再嵌套一层,`node_modules/readable-stream` 无限累加,直到 `cp` 因为
          // 路径长度爆炸报 `File name too long`。修法:自引用(sibling 的真实路径
          // 就是当前正在处理的这个包自己)直接跳过,不入队——它不携带任何新信息。
          if (scopedReal === pkgReal) continue;
          queue.push({ pkgReal: scopedReal, parentDestDir: destDir });
        }
        continue;
      }
      const childReal = await realpath(child);
      if (childReal === pkgReal) continue;
      queue.push({ pkgReal: childReal, parentDestDir: destDir });
    }
  }

  if (!(await isComplete(flatDir))) {
    throw new Error(`flat module materialization failed: ${flatDir} is incomplete after copy`);
  }
  return flatDir;
}

async function isComplete(cacheDir: string): Promise<boolean> {
  for (const pkg of PREINSTALLED_PACKAGES) {
    if (!(await exists(join(cacheDir, pkg, "package.json")))) return false;
  }
  return true;
}

async function packageMeta(pkgDir: string): Promise<{ readonly name: string; readonly version: string } | undefined> {
  try {
    const raw = await readFile(join(pkgDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    if (typeof parsed.name !== "string" || parsed.name === "") return undefined;
    // 版本号缺失(极少数包不写)时退化成空串——效果等同于"总是被当成同一版本",
    // 与旧行为(纯按名字去重)一致,不会比修复前更差。
    const version = typeof parsed.version === "string" ? parsed.version : "";
    return { name: parsed.name, version };
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
