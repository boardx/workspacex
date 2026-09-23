/**
 * feature-id.ts —— #1094：把 feature 编号的**分配点**从「开工时读到的 max+1 快照」
 * 挪到「claim 那一次命令」，并在脚本内做「读—校验—写 + 撞号重试」。
 *
 * 根因（issue #1094 实测，2026-08-12 同一条 feature 一天内连撞两次）：
 * 编号按**读取时刻**的 max+1 挑，而这个号真正写进 feature_list.json 要等整个实现
 * 周期（数小时）之后。main 前进得比一个 feature 做完还快（那天一天涨 7 个号）
 * ⇒ 撞号是常态不是意外；而且撞了**不会报错**——两个分支各自本地全绿，直到合并才
 * 发现，那时号已经写进实现注释、测试 describe、commit message 和 evidence 文件名
 * （`F168.verify.log`）里，改一次要同步改五处，漏一处就留下一个指向别人 feature 的
 * 错误引用。
 *
 * 方案 B（coord-main 2026-08-13 在 issue #1094 的裁决）：
 *   条目先以**占位 id**（`F-TBD-<slug>`）写入清单，`pnpm harness claim` 时才取号回填。
 *   窗口从「一个 feature 的实现周期」压到「一次命令」。
 *
 * 剩下的那一点窗口（两个 claim 同秒）由本文件的临界区兜住：
 *   ① 目录锁（`mkdir` 在 POSIX 上是原子的）把同一份清单的取号串行化；
 *   ② **锁内重新读文件**——调用方在临界区之外读到的任何 max 一律不作数
 *      （AGENTS.md「静态痕迹 ≠ 动态事实」：会话早期那句「当前最大是 F164」正是
 *      #1094 里骗人的那个痕迹）；
 *   ③ 写回后再读一次核对，发现重号/被覆盖就回滚成占位 id 重试——防的是**不持锁的
 *      写入方**（有人手改文件、或旧版本脚本还在跑）。
 *
 * 与 `adr-id.ts` / `template-id.ts` 的关系：那两处靠「占号即登记 + 权威载体唯一 ⇒
 * 合并时文本冲突可见」防**跨分支**撞号，本文件沿用同一个权威载体
 * （`phases/<phase>/feature_list.json`，不引入第二份号段登记表），只是在同一工作树内
 * 再加一道真锁。号段预分（方案 A）被否：本仓多处默认编号递增（`covers:` 排序、进度表）。
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archivedIdsAt, parseFeatureList, readFeatureListAt, readFeatureListRawAt, writeFeatureListAt } from "./features";
import type { Feature } from "./types";

/** 正式编号：`F` + 十进制序号（历史上有 F01 也有 F1681，位数不固定）。 */
export const FEATURE_ID_RE = /^F(\d+)$/;

/**
 * 占位 id：`F-TBD-<slug>`。requirement-author 生成新条目时写它，claim 时换成真号。
 * slug 必须能区分同一批里的多个占位条目（它们在回填前是清单里的真实 key）。
 * 刻意不与 `F\d+` 共用形态：任何还没取号的条目，肉眼与机器都要一眼能认出来。
 */
export const PLACEHOLDER_FEATURE_ID_RE = /^F-TBD-[A-Za-z0-9][A-Za-z0-9-]*$/;

/** `"F172"` → 172；不是正式编号（含占位 id）→ null。 */
export function featureIdNumber(id: string): number | null {
  const m = FEATURE_ID_RE.exec(id.trim());
  return m ? Number.parseInt(m[1]!, 10) : null;
}

export function isPlaceholderFeatureId(id: string): boolean {
  return PLACEHOLDER_FEATURE_ID_RE.test(id.trim());
}

/**
 * 下一个编号 = 现有编号数字部分的 max + 1，最少两位零填充（沿用 F01 起的既有格式）。
 *
 * **中间空洞不回填**（同 ADR / Template 序列的既定策略）：被 claim 取走又放弃的号
 * 就让它空着。回填空洞会让「号是递增的」这个本仓多处依赖的性质失效，
 * 也会把一个刚被别人写进 commit message 的号重新发出去。
 *
 * 传进来的 id 列表必须**同时包含 live 与 archive**：归档只是搬家，那些号同样已被占用。
 */
export function nextFeatureId(existingIds: readonly string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const n = featureIdNumber(id);
    if (n !== null && n > max) max = n;
  }
  return `F${String(max + 1).padStart(2, "0")}`;
}

/** 重复出现的 id（升序去重）。空数组 = 没有撞号。 */
export function duplicateFeatureIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    else seen.add(id);
  }
  return [...dup].sort();
}

/** 取号锁目录（唯一拼接处，不要在别处拼这个后缀；已进 .gitignore）。 */
export function featureIdLockDir(listPath: string): string {
  return `${listPath}.lock`;
}

/** 超过这么久没被释放的锁视为陈旧（持锁进程已死），允许接管——
 *  否则一次 Ctrl-C 就能让整个 phase 永远取不了号。 */
export const STALE_LOCK_MS = 30_000;
const LOCK_POLL_MS = 25;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 5;

/** 同步睡眠（本文件全程同步 IO，不引入 async 传染整条 claim 调用链）。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockAgeMs(lockDir: string): number | null {
  try {
    return Date.now() - statSync(lockDir).mtimeMs;
  } catch {
    return null; // 刚刚被别人释放了
  }
}

/** 目录锁：`mkdir` 存在即失败且无中间态，是 POSIX 上不依赖额外依赖的原子操作。 */
function acquireLock(listPath: string, timeoutMs: number): () => void {
  const lockDir = featureIdLockDir(listPath);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(
        join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }, null, 2) + "\n",
        "utf8",
      );
      return () => rmSync(lockDir, { recursive: true, force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const age = lockAgeMs(lockDir);
      if (age !== null && age > STALE_LOCK_MS) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `取号锁 ${lockDir} 被占用超过 ${timeoutMs}ms——另一个 claim 还在跑（或留下了锁目录）。` +
            `确认没有其它进程在取号后删掉该目录重试。`,
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
}

export interface AllocateFeatureIdOptions {
  /** 权威载体：`phases/<phase>/feature_list.json` 的路径。 */
  listPath: string;
  /** 同目录的 `feature_list.archive.json`（可不存在）；它的 id 同样算占用。 */
  archivePath?: string;
  /** 要回填的占位条目 id。 */
  placeholderId: string;
  /**
   * 取号成功后要一并改写引用的文件（claim 传「`covers:` 里点名了这个占位 id 的
   * 已签契约束 / delta」）。只替换那一个完整 token，不碰文件里的其它任何字。
   *
   * 为什么必须做：`covers:` 是签核归属的权威声明，占位 id 换了号而它没换，
   * 这条 feature 立刻变成「不属于任何契约束」——claim 刚放行、doctor 就判红。
   * #1094 原文抱怨的正是这个：「改一次号要同步改 5 处，漏一处就留下一个指向
   * 别人 feature 的错误引用」。所以由取号这同一条命令改，不留给人记得。
   */
  referenceFiles?: readonly string[];
  maxAttempts?: number;
  lockTimeoutMs?: number;
  /** **仅测试注入**：在「锁内读」与「写回」之间调用，用来模拟一个不持锁的并发写入方。 */
  onBeforeWrite?: (attempt: number) => void;
}

export interface AllocateFeatureIdResult {
  id: string;
  /** 第几次尝试成功（> 1 说明真的撞上了，并被重试兜住）。 */
  attempts: number;
  /** 实际被改写了占位 id 引用的文件（清单自身 + 各签核文件）。供 claim 回显。 */
  renamedReferences: string[];
}

/**
 * 原子取号并回填占位条目。返回分配到的正式编号。
 *
 * 调用点必须是**使用点**（claim），不是「开工前先想好一个号」——后者就是 #1094 本身。
 */
export function allocateFeatureId(opts: AllocateFeatureIdOptions): AllocateFeatureIdResult {
  const { listPath, archivePath, placeholderId } = opts;
  if (!isPlaceholderFeatureId(placeholderId)) {
    throw new Error(
      `${placeholderId} 不是占位 id（形如 F-TBD-<slug>）——取号只回填占位条目，绝不重写一个已经发出去的编号。`,
    );
  }
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const archived = (): Set<string> => (archivePath ? archivedIdsAt(archivePath) : new Set<string>());

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const release = acquireLock(listPath, opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    try {
      // ① 锁内重新读：这一读就是分配依据。任何更早读到的 max 一律不作数。
      const raw = readFeatureListRawAt(listPath);
      const fl = parseFeatureList(raw, listPath);
      const entry = fl.features.find((f) => f.id === placeholderId);
      if (!entry) {
        throw new Error(`${listPath} 里没有 id=${placeholderId} 的条目——占位 id 写错了，或它已经被取过号。`);
      }
      const archivedIds = archived();
      const id = nextFeatureId([...fl.features.map((f) => f.id), ...archivedIds]);

      opts.onBeforeWrite?.(attempt);

      // ② 写回前比对字节（乐观并发 / CAS）：文件在我们读之后被动过，就**不写**，
      //    重来一轮。整份写是覆盖式的——不比对的话，我们不仅按过期的 max 取了号，
      //    还会把对方那次写连人带号一起抹掉，两头都没人报错。
      if (readFeatureListRawAt(listPath) !== raw) continue;

      entry.id = id;
      writeFeatureListAt(listPath, fl, archivedIds);

      // ③ 写回后再读一次核对。持锁者之间这一步永远通过；它兜的是「不持锁的写入方
      //    赶在我们写完之后才落盘」这一种——撞上就回滚重试，绝不把重号留在盘上。
      const after = [...readFeatureListAt(listPath).features.map((f) => f.id), ...archived()];
      if (after.filter((x) => x === id).length !== 1) {
        rollbackToPlaceholder(listPath, entry, placeholderId, archived());
        continue;
      }

      // ④ 号定下来之后，才动引用。放在核对之后是为了让回滚只需要撤一件事
      //    （条目自己的 id）；引用改写这一步不会被回滚路径穿过。
      const renamedReferences = renameReferences(listPath, archivedIds, placeholderId, id, opts.referenceFiles ?? []);
      return { id, attempts: attempt, renamedReferences };
    } finally {
      release();
    }
  }
  throw new Error(
    `取号重试 ${maxAttempts} 次仍撞号（${listPath}）——有进程在不持锁地写 feature_list.json。` +
      `先查清楚谁在写，不要绕过重试直接指定 id。`,
  );
}

/** 正则转义（占位 id 里只可能有 `-`，但不要依赖这一点）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把占位 id 的引用换成正式编号：
 *   · 同一份清单里其它条目的 `depends_on`（结构化改写）；
 *   · 调用方点名的签核文件里的 `covers:`（**只替换完整 token**：前后不能再跟
 *     字母/数字/连字符，所以 `F-TBD-room` 不会误伤 `F-TBD-room-invite`）。
 * 返回真正被改动的文件路径。
 */
function renameReferences(
  listPath: string,
  archivedIds: ReadonlySet<string>,
  placeholderId: string,
  id: string,
  referenceFiles: readonly string[],
): string[] {
  const changed: string[] = [];

  const fl = readFeatureListAt(listPath);
  let touched = false;
  for (const f of fl.features) {
    if (!f.depends_on?.includes(placeholderId)) continue;
    f.depends_on = f.depends_on.map((d) => (d === placeholderId ? id : d));
    touched = true;
  }
  if (touched) {
    writeFeatureListAt(listPath, fl, archivedIds);
    changed.push(listPath);
  }

  const token = new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(placeholderId)}(?![A-Za-z0-9-])`, "g");
  for (const file of referenceFiles) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(token, id);
    if (after === before) continue;
    writeFileSync(file, after, "utf8");
    changed.push(file);
  }
  return changed;
}

/**
 * 把刚写下去的号改回占位 id，好让下一次尝试重新取号。
 *
 * **只回滚我们自己写的那一条**：撞号时盘上另一条挂着同一个号的条目是别人的，
 * 动它就是在替别人改编号——#1094 抱怨的正是这种「一个号被改来改去」。
 * 身份判据是「整条内容与我们写下去的那条逐字节相同」；认不出来就抛错交给人，
 * 不猜（猜错会把两个 feature 的编号搅在一起，比报错难查得多）。
 */
function rollbackToPlaceholder(
  listPath: string,
  written: Feature,
  placeholderId: string,
  archivedIds: ReadonlySet<string>,
): void {
  const fl = readFeatureListAt(listPath);
  const fingerprint = JSON.stringify(written);
  const mine = fl.features.filter((f) => JSON.stringify(f) === fingerprint);
  if (mine.length === 0) return; // 我们的写被整份覆盖了，盘上已经没有这条——直接重试即可
  if (mine.length > 1) {
    throw new Error(
      `${listPath} 里有 ${mine.length} 条与本次写入完全相同的条目（id=${written.id}）——` +
        `无法判断哪一条是本次取号写下的，拒绝乱改。请人工核对后再重跑 claim。`,
    );
  }
  mine[0]!.id = placeholderId;
  writeFeatureListAt(listPath, fl, archivedIds);
}

