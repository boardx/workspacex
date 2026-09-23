/**
 * 把随包的 7.5 GB 模型导入 Ollama 存储时，**说清楚还要多久**（#3872 维度 2）。
 *
 * ## 改之前是什么样
 *
 * `importModels` 是一个同步阻塞的拷贝循环：新机器第一次启动时它要搬 7.5 GB，
 * 期间**一个字都不说**，进度页停在上一条日志上。评分卡对「首次运行与重资源就绪」
 * 的 9 分判据第一句就是「全程确定性百分比 + 剩余时间」，7 分那一档写的正是
 * 「有进度条但是转圈」——我们连转圈都没有。
 *
 * 而且原来的判据是**只比文件大小**：
 *
 * ```ts
 * if (existsSync(dst) && statSync(dst).size === statSync(src).size) return false;
 * ```
 *
 * 同一个模块的头注却写着「skipping blobs that are already there (**same digest = same bytes**)」。
 * blob 的文件名**就是它的 sha256**，摘要一直躺在那里没人用。大小相同而内容不同的 blob
 * （拷到一半被断电、磁盘坏块）会被当成「已经有了」跳过，然后 Ollama 拿到一个能通过
 * 我们检查、却加载不出来的模型。这是本仓记过的那一类：**注释承诺了代码没做的事**。
 *
 * ## 这里做三件
 *
 * 1. **先数清楚再搬**：`planImport` 把要拷的 blob 和总字节数算出来，于是百分比是
 *    确定性的，不是转圈；剩余时间由已用时间和已搬字节外推。
 * 2. **边拷边算 sha256**：一趟流式拷贝同时算摘要，拷完与文件名里的摘要比对，
 *    对不上就删掉重来。一趟完成，不额外读一遍 7.5 GB。
 * 3. **先写 `.part` 再改名**：改名在同一文件系统上是原子的，所以**中途被杀不会留下
 *    一个大小正好、内容残缺的 blob**——这正是原来那条只比大小的判据看不出来的东西，
 *    也是「可续传」在这里的真实含义：没搬完的永远不会被下一次当成搬完了。
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";

export interface ImportProgress {
  /** 正在搬哪个模型，给用户看的名字。 */
  readonly model: string;
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly blobsDone: number;
  readonly blobsTotal: number;
  /** 剩余秒数；样本还不够时是 null——**不要编一个数字**。 */
  readonly etaSeconds: number | null;
}

/**
 * 剩余时间。
 *
 * 刚开始的几百毫秒里外推出来的数字会在「3 秒」和「4 分钟」之间乱跳，比不显示更糟
 * （评分卡的尺子那一节：进度条 2 秒起、5 秒必须——说的是进度条，不是抖动的假预测）。
 * 所以样本不足时返回 null，由界面显示「正在估算」。
 */
export function etaSeconds(bytesDone: number, bytesTotal: number, elapsedMs: number): number | null {
  if (bytesDone <= 0 || elapsedMs < 1_000) return null;          // 不足 1 秒不外推
  if (bytesDone >= bytesTotal) return 0;
  const bytesPerMs = bytesDone / elapsedMs;
  if (bytesPerMs <= 0) return null;
  return Math.round((bytesTotal - bytesDone) / bytesPerMs / 1000);
}

/** 「1.2 GB」这种，给人看的。 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/** 「还要 3 分 20 秒」，null 时说「正在估算」。 */
export function humanEta(seconds: number | null): string {
  if (seconds === null) return "正在估算";
  if (seconds <= 0) return "就好";
  if (seconds < 60) return `还要约 ${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `还要约 ${m} 分` : `还要约 ${m} 分 ${s} 秒`;
}

/** blob 文件名里的摘要：`sha256-abc…` → `abc…`；不是这个形状就返回 null。 */
export function digestFromBlobPath(path: string): string | null {
  const m = /(?:^|\/)sha256-([0-9a-f]{64})$/.exec(path);
  return m === null ? null : (m[1] ?? null);
}

/**
 * 一趟流式拷贝 + 校验 + 原子改名。
 *
 * 返回 false 表示目标已经存在且**摘要正确**，什么都没做。
 * 校验失败会抛——把一个坏 blob 留在存储里，比启动失败难查得多。
 */
export async function copyBlobVerified(
  src: string,
  dst: string,
  opts: { readonly onBytes?: (delta: number) => void; readonly verifyExisting?: boolean } = {},
): Promise<boolean> {
  const want = digestFromBlobPath(dst);
  if (existsSync(dst)) {
    // 默认只比大小（每次启动重算 7.5 GB 的 sha256 要几十秒，代价不合理）；
    // 真要较真时 verifyExisting 打开——恢复流程和自检会用。
    if (opts.verifyExisting === true && want !== null) {
      if (await sha256File(dst) === want) return false;
      rmSync(dst, { force: true });
    } else if (statSync(dst).size === statSync(src).size) {
      return false;
    } else {
      rmSync(dst, { force: true });
    }
  }
  mkdirSync(dirname(dst), { recursive: true });
  const part = `${dst}.part`;
  rmSync(part, { force: true });
  const hash = createHash("sha256");
  /*
    ⚠ 不要写成 `rs.on("data", …)` 之后再 `pipeline(rs, ws)`：挂上 data 监听会让可读流
      立刻进入流动模式，在 pipeline 把下游接上之前就开始吐数据，**前几块可能丢掉**。
      丢块的后果在这里恰好是「摘要对不上」，会被当成源文件损坏——一个查起来很贵的假故障。
      所以计数和算摘要都放在管道中间的 Transform 里，数据只走一条路。
  */
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      opts.onBytes?.(chunk.length);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(src), tap, createWriteStream(part));
    const got = hash.digest("hex");
    if (want !== null && got !== want) {
      rmSync(part, { force: true });
      throw new Error(`随包模型文件损坏：${src} 的内容校验不通过（期望 ${want.slice(0, 12)}…，实际 ${got.slice(0, 12)}…）`);
    }
    renameSync(part, dst);   // 同一文件系统上原子：要么没有，要么是完整的
    return true;
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}
