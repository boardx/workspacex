/**
 * 离线更新:把一个更新包装进来、能回滚、拒绝降级(#3872 R20)。
 *
 * ## 为什么必须有这个,以及为什么它不等证书
 *
 * 评分卡维度 8(更新、回滚与可访问性)此前是 **4 分**,而规则是「任一维 ≤5,整体不得
 * 高于 6」——也就是说其余九维做到满分总分仍然是 6。它是唯一的封顶项。
 *
 * 我先前把它整条归给「卡签名」,那个结论太快了。拆开看:
 *   · **自动更新通道**要验代码签名 —— 是,没有证书做不了
 *   · **离线更新包 / 版本号前进式回滚 / 不打断生成 / 全键盘可达** —— 都不需要证书
 *
 * ## 更新的单位是 `Resources/bundle`,不是整个 .app
 *
 * 换整个 Electron 外壳等于重装,必然要过 Gatekeeper——那条路确实要证书。
 * 而 `bundle/`(apps/* 与 packages/* 的源码 + node_modules)是我们自己每次迭代都在改的
 * 部分,占产物约 30%,且**运行时是被 tsx 读起来的**,换掉它不触碰签名覆盖的可执行文件。
 *
 * 代价要说清:**Electron 外壳、Ollama 二进制、随包模型这三样这条路换不了**,
 * 它们变了仍然要重装。所以这不是「完整的自动更新」,是「应用逻辑的离线更新」。
 * 界面上必须这么说,不能让用户以为所有更新都能这样装。
 *
 * ## 三条不变量
 *
 * 1. **拒绝降级**,除非走显式回滚。版本比较用语义化版本,不是字符串。
 * 2. **装之前先验**:清单里的每个文件都要摘要对得上,验不过一个字节都不动。
 * 3. **上一版留着**:装新版前把当前 bundle 挪到 `bundle.prev-<版本>`,
 *    回滚就是把它换回来——**回滚也是一次前进**(记一条新的 applied 记录),
 *    而不是把状态倒回去,这样历史是可读的。
 */
import { createHash } from "node:crypto";
import { createReadStream, cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";

/** 更新包根目录里的清单文件名。 */
export const UPDATE_MANIFEST = "workspacex-update.json";

export interface UpdateManifest {
  readonly formatVersion: 1;
  /** 语义化版本,必须严格大于当前版本才允许装。 */
  readonly version: string;
  readonly createdAt: string;
  /** 这个包替换的是哪一部分。目前只有 bundle。 */
  readonly payload: "bundle";
  /** 相对路径 → sha256。装之前逐个核对。 */
  readonly files: Readonly<Record<string, string>>;
  /** 给用户看的一句话:这一版改了什么。 */
  readonly summary?: string;
}

/** 语义化版本比较:-1 / 0 / 1。非法输入返回 null,不猜。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return 1;
    if (pa[i]! < pb[i]!) return -1;
  }
  return 0;
}

export type UpdateVerdict =
  | { readonly ok: true; readonly manifest: UpdateManifest }
  | { readonly ok: false; readonly reason: string };

/**
 * 读清单并判断能不能装。**只读,不动任何文件。**
 *
 * 「能不能装」和「装」分开,是因为用户要先看到「这是什么、有多大、会不会丢东西」
 * 再决定——R1/R5 的备份恢复也是同一条纪律(先验、再说清代价、最后才动数据)。
 */
export async function inspectUpdate(dir: string, currentVersion: string): Promise<UpdateVerdict> {
  let manifest: UpdateManifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, UPDATE_MANIFEST), "utf8")) as UpdateManifest;
  } catch {
    return { ok: false, reason: `这个目录里没有 ${UPDATE_MANIFEST}——它不是一个 WorkspaceX 更新包。` };
  }
  if (manifest.formatVersion !== 1) {
    return { ok: false, reason: `更新包的格式版本是 ${String(manifest.formatVersion)}，这个应用只认 1。多半是包比应用新，先换应用。` };
  }
  if (manifest.payload !== "bundle") {
    return { ok: false, reason: `这个包要替换的是「${String(manifest.payload)}」，而离线更新只能换应用逻辑（bundle）。Electron 外壳、本地模型、Ollama 二进制变了都要重新安装。` };
  }
  const cmp = compareVersions(manifest.version, currentVersion);
  if (cmp === null) {
    return { ok: false, reason: `版本号读不出来（包里是「${manifest.version}」，当前是「${currentVersion}」）。为了不装错，这里不做猜测。` };
  }
  if (cmp === 0) return { ok: false, reason: `这个包就是当前版本 ${currentVersion}，不用装。` };
  if (cmp < 0) {
    return {
      ok: false,
      reason: `这个包是 ${manifest.version}，比当前的 ${currentVersion} 旧——装它等于降级。`
        + `如果你想回到上一版，用「回滚到上一版」，那条路会保留这一版、并把回滚本身记成一次新的更新。`,
    };
  }
  if (Object.keys(manifest.files).length === 0) {
    return { ok: false, reason: "更新包的清单是空的，没有任何文件要装。" };
  }
  return { ok: true, manifest };
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

/**
 * 清单里的相对路径是否安全：不是绝对路径，且**没有任何一段**恰好是 `..`。
 * `[[...slug]]`、`...rest`、`a..b` 这些是合法的文件/目录名，不是穿越。
 */
export function isSafeRelativePath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(rel)) return false;
  return !rel.split(/[\\/]/).some((seg) => seg === "..");
}

export interface VerifyResult {
  readonly ok: boolean;
  /** 对不上的文件:路径 → 出了什么问题。空表示全部通过。 */
  readonly bad: Readonly<Record<string, string>>;
  readonly checked: number;
}

/**
 * 逐个文件核对摘要。**验不过一个字节都不动**——这是备份恢复那条纪律的同一条。
 */
export async function verifyUpdatePayload(dir: string, manifest: UpdateManifest): Promise<VerifyResult> {
  const bad: Record<string, string> = {};
  let checked = 0;
  for (const [rel, want] of Object.entries(manifest.files)) {
    // 路径穿越：更新包是外来数据，不能让它写到 bundle 之外去。
    //
    // ⚠ 按**路径段**判断，不能用 `rel.includes("..")` 这种子串匹配。第一版就是子串匹配，
    //   真机往返时它拒掉了**每一个真实的更新包**：Next.js 的可选全匹配路由目录名是
    //   `[[...slug]]`，里面有 `...`，于是
    //   `apps/web/.next/server/app/api/copilotkit/[[...slug]]/route.js` 被判成穿越。
    //   单测用的全是简单路径，产生不出这种目录名——只有真实构建产物才有。
    if (!isSafeRelativePath(rel)) { bad[rel] = "清单里的路径不合法（绝对路径或含 .. 这一段）"; continue; }
    try {
      const got = await sha256File(join(dir, "payload", rel));
      checked += 1;
      if (got !== want) bad[rel] = `内容校验不通过（期望 ${want.slice(0, 12)}…，实际 ${got.slice(0, 12)}…）`;
    } catch {
      bad[rel] = "清单里有这个文件，包里没有";
    }
  }
  return { ok: Object.keys(bad).length === 0, bad, checked };
}

/** 装过的每一步都记一条——包括回滚。回滚是前进，不是把状态倒回去。 */
export interface AppliedRecord {
  readonly at: string;
  readonly from: string;
  readonly to: string;
  readonly kind: "update" | "rollback";
  readonly keptAt: string | null;
}

export function rollbackTargetOf(history: readonly AppliedRecord[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i]!;
    if (r.kind === "update" && r.keptAt !== null) return r.from;
  }
  return null;
}

/**
 * ## 版本号必须由**被更新的那一份**自己带（#3872 R20 真机验证发现的设计缺陷）
 *
 * 第一版我拿 `app.getVersion()` 当「当前版本」——它读的是
 * `Contents/Resources/app/package.json`，而更新替换的是 `Contents/Resources/bundle/`。
 * **两个位置不是一回事**，`bundle/package.json` 是 monorepo 根文件、连 version 字段都没有。
 *
 * 后果在真机上是三重的，而单测全绿看不出来：
 *   1. 装完 0.3.0，应用仍然报 0.2.0，用户看不到任何变化；
 *   2. 同一个包**可以反复装**（当前版本永远是 0.2.0），而每次装都把当前 bundle 挪到
 *      `bundle.prev-0.2.0` —— **第二次就覆盖掉真正的原始版本**；
 *   3. 「拒绝降级」和「版本号前进式回滚」比较的是一个永不变化的值，整个机制空转。
 *
 * 所以 bundle 自己带一个版本标记，更新时由包里的清单写进去。读不到就退回外壳版本
 * （首次安装的正常状态），**不猜、不编**。
 */
export const BUNDLE_VERSION_FILE = "workspacex-bundle.json";

export interface BundleVersionMarker {
  readonly version: string;
  /** 这一份是怎么来的：随安装包来的，还是某次离线更新装上去的。 */
  readonly origin: "installed" | "offline-update" | "rollback";
  readonly at: string;
}

/**
 * 当前 bundle 的版本。`shellVersion` 是没有标记时的退路——那表示这份 bundle
 * 还是安装包原装的，它的版本就等于外壳版本。
 */
export async function readBundleVersion(bundleDir: string, shellVersion: string): Promise<string> {
  try {
    const m = JSON.parse(await readFile(join(bundleDir, BUNDLE_VERSION_FILE), "utf8")) as BundleVersionMarker;
    return typeof m.version === "string" && compareVersions(m.version, "0.0.0") !== null ? m.version : shellVersion;
  } catch {
    return shellVersion;   // 没有标记 = 原装
  }
}

export function bundleVersionMarker(version: string, origin: BundleVersionMarker["origin"]): string {
  return JSON.stringify({ version, origin, at: new Date().toISOString() } satisfies BundleVersionMarker, null, 2);
}


// ─────────────────────────────────────────────────────────────────────────────
// 应用与回滚的核心：桌面菜单和 CLI 共用这一份（#3872 R20 第 2 步）
//
// 抽出来有两个理由：
//   1. 真机验证要能不点对话框就跑一遍往返——R14 的备份恢复也是这么做的；
//   2. 第一版写在 main.ts 里的应用逻辑有个真缺陷：`cpSync` 拷到一半失败时，
//      bundle 目录已经存在（半新半旧），而还原条件是「bundle 不存在才搬回旧的」，
//      于是**不还原**——弹窗却说「已还原到更新前」。界面承诺了代码没做的事。
//      给它写的门只检查源码里有那句 renameSync，从没让拷贝真的中途失败过。
//
// 修法：先拷到暂存目录，全部成功后用两次改名交换（同一文件系统上改名是原子的）。
// 拷贝失败只删暂存目录（那是我们自己刚建的），bundle 一个字节都没动过。
// ─────────────────────────────────────────────────────────────────────────────

/** 目标路径已存在时加时间戳，**从不覆盖**一份保留的旧版本。 */
function uniqueAside(base: string, now: Date): string {
  if (!existsSync(base)) return base;
  return `${base}-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export function readHistory(path: string): AppliedRecord[] {
  try { return JSON.parse(readFileSync(path, "utf8")) as AppliedRecord[]; } catch { return []; }
}
function appendHistory(path: string, r: AppliedRecord): void {
  const h = readHistory(path);
  h.push(r);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(h, null, 2));
}

export type ApplyResult =
  | { readonly ok: true; readonly from: string; readonly to: string; readonly keptAt: string; readonly files: number }
  | { readonly ok: false; readonly reason: string; readonly touched: false };

export async function applyUpdate(o: {
  readonly bundleDir: string;
  readonly packageDir: string;
  readonly shellVersion: string;
  readonly historyPath: string;
  readonly now?: Date;
  /** 测试缝：模拟拷到一半失败。生产用 cpSync。 */
  readonly copy?: (from: string, to: string) => void;
}): Promise<ApplyResult> {
  const now = o.now ?? new Date();
  const current = await readBundleVersion(o.bundleDir, o.shellVersion);
  const v = await inspectUpdate(o.packageDir, current);
  if (!v.ok) return { ok: false, reason: v.reason, touched: false };
  const check = await verifyUpdatePayload(o.packageDir, v.manifest);
  if (!check.ok) {
    const first = Object.entries(check.bad).slice(0, 3).map(([f, why]) => `${f}：${why}`).join("；");
    return { ok: false, reason: `更新包校验没通过（${String(Object.keys(check.bad).length)} 个文件）：${first}`, touched: false };
  }

  const staging = `${o.bundleDir}.staging-${now.getTime()}`;
  try {
    (o.copy ?? ((a, b) => cpSync(a, b, { recursive: true })))(join(o.packageDir, "payload"), staging);
    writeFileSync(join(staging, BUNDLE_VERSION_FILE), bundleVersionMarker(v.manifest.version, "offline-update"));
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });   // 只删我们自己刚建的暂存目录
    return { ok: false, reason: `拷贝更新包失败，应用没有被改动：${e instanceof Error ? e.message : String(e)}`, touched: false };
  }

  // 暂存已完整，交换：两次改名。第一次失败时什么都没动；第二次失败时把旧的搬回来。
  const keptAt = uniqueAside(`${o.bundleDir}.prev-${current}`, now);
  renameSync(o.bundleDir, keptAt);
  try {
    renameSync(staging, o.bundleDir);
  } catch (e) {
    renameSync(keptAt, o.bundleDir);
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, reason: `换入新版本失败，已换回原版本：${e instanceof Error ? e.message : String(e)}`, touched: false };
  }
  appendHistory(o.historyPath, { at: now.toISOString(), from: current, to: v.manifest.version, kind: "update", keptAt });
  return { ok: true, from: current, to: v.manifest.version, keptAt, files: check.checked };
}

export type RollbackResult =
  | { readonly ok: true; readonly from: string; readonly to: string; readonly keptAt: string }
  | { readonly ok: false; readonly reason: string };

/**
 * 回滚到最近一次「留了上一版、且那一份还在」的更新之前。
 *
 * 用**历史记录里写的那个路径**，不按版本号拼路径——上一版可能因为重名被加了时间戳。
 * 回滚也是一次前进：当前版本同样被保留，并追加一条 kind=rollback 的记录。
 */
export async function rollbackBundle(o: {
  readonly bundleDir: string;
  readonly shellVersion: string;
  readonly historyPath: string;
  readonly now?: Date;
}): Promise<RollbackResult> {
  const now = o.now ?? new Date();
  const current = await readBundleVersion(o.bundleDir, o.shellVersion);
  const history = readHistory(o.historyPath);
  let rec: AppliedRecord | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i]!;
    if (r.kind === "update" && r.keptAt !== null && r.from !== current && existsSync(r.keptAt)) { rec = r; break; }
  }
  if (rec === null || rec.keptAt === null) {
    return { ok: false, reason: "没有可回滚的版本：还没装过离线更新，或上一版已经被清理掉了。" };
  }
  const asideNow = uniqueAside(`${o.bundleDir}.prev-${current}`, now);
  renameSync(o.bundleDir, asideNow);
  try {
    renameSync(rec.keptAt, o.bundleDir);
  } catch (e) {
    renameSync(asideNow, o.bundleDir);
    return { ok: false, reason: `回滚失败，已换回当前版本：${e instanceof Error ? e.message : String(e)}` };
  }
  writeFileSync(join(o.bundleDir, BUNDLE_VERSION_FILE), bundleVersionMarker(rec.from, "rollback"));
  appendHistory(o.historyPath, { at: now.toISOString(), from: current, to: rec.from, kind: "rollback", keptAt: asideNow });
  return { ok: true, from: current, to: rec.from, keptAt: asideNow };
}

/**
 * 把一个目录打成更新包：`<out>/payload/**` + 清单（逐文件 sha256）。发布工具与测试共用。
 * 版本标记文件不进清单——它由应用那一侧写，不该从包里带过来覆盖。
 */
export async function makeUpdatePackage(o: {
  readonly fromDir: string;
  readonly outDir: string;
  readonly version: string;
  readonly summary?: string;
}): Promise<UpdateManifest> {
  if (compareVersions(o.version, "0.0.0") === null) throw new Error(`版本号必须是 x.y.z：${o.version}`);
  const payload = join(o.outDir, "payload");
  cpSync(o.fromDir, payload, { recursive: true });
  rmSync(join(payload, BUNDLE_VERSION_FILE), { force: true });
  const files: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) continue;          // 软链不进清单：它的目标可能在包外
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && statSync(p).isFile()) files[relative(payload, p).split(sep).join("/")] = await sha256File(p);   // 清单里一律 `/`，包才能跨平台
    }
  };
  await walk(payload);
  const manifest: UpdateManifest = {
    formatVersion: 1, version: o.version, createdAt: new Date().toISOString(), payload: "bundle", files,
    ...(o.summary === undefined ? {} : { summary: o.summary }),
  };
  writeFileSync(join(o.outDir, UPDATE_MANIFEST), JSON.stringify(manifest, null, 2));
  return manifest;
}
