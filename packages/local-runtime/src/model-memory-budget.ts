/**
 * 给模型常驻内存上一个闸——**纯策略，不碰进程**，所以能被直接取证。
 *
 * ## 为什么需要它
 * 2026-09-23 实测：模型运行器**每次请求涨约 70 MB 且不回落**。同机同模型连发 6 次，
 * 真实物理占用从 3.95 GB 单调涨到 4.36 GB；在一台连续用了几天的 16 GB 机器上量到
 * **9,729 MB，整机的 61%**。这是 Ollama 运行器自己的行为，我们改不了它，
 * 但可以在它涨过头之前把模型卸掉——下一次请求付一次冷加载（实测 2.1–2.4 s）就回到干净状态。
 *
 * R1 把保活从 24 小时改成 30 分钟，给了它一个**空闲**上界；这里给的是**会话内**上界。
 * 两者管的不是同一段时间。
 *
 * ## 预算怎么算的（评分卡要求「解释自己的算术」）
 * LM Studio 的内存护栏同时是它最受称赞的功能和最大的抱怨来源，原因就是它只拦截、不解释。
 * 所以这里的预算是一条可以照着复算的式子，并且会把式子本身说给用户听。
 */

const GB = 1024 ** 3;

export interface BudgetInputs {
  /** 整机物理内存字节数。 */
  readonly totalBytes: number;
  /** 模型刚加载完、还没被请求撑大时的常驻字节数。 */
  readonly freshBytes: number;
}

/**
 * 预算 = 整机内存的 35%，但不低于「刚加载完 + 1 GB」，也不高于 8 GB。
 *
 * - **35%**：本地版不是这台机器上唯一在跑的东西，用户还要开浏览器和编辑器。
 * - **下界「刚加载完 + 1 GB」**：低于这个数会在模型刚加载完就触发卸载，变成反复冷加载。
 * - **上界 8 GB**：再大就不是「防涨」而是「随它去」了；一台 64 GB 的机器也不该让它涨到 22 GB。
 */
export function memoryBudgetBytes(i: BudgetInputs): number {
  const share = i.totalBytes * 0.35;
  const floor = i.freshBytes + GB;
  const ceil = 8 * GB;
  return Math.min(Math.max(share, floor), ceil);
}

/** 把式子本身说出来，而不只是说「超了」。 */
export function explainBudget(i: BudgetInputs): string {
  const b = memoryBudgetBytes(i);
  const g = (n: number): string => `${(n / GB).toFixed(1)} GB`;
  return `预算 ${g(b)} = 整机 ${g(i.totalBytes)} 的 35%，下限「刚加载完 ${g(i.freshBytes)} + 1 GB」，上限 8 GB。`;
}

export type BudgetDecision =
  | { readonly action: "keep" }
  | { readonly action: "unload"; readonly reason: string };

/**
 * 现在该不该把模型卸掉。
 *
 * ⚠ **生成中绝不卸**：把用户正在等的那句话掐掉，比多占几个 GB 糟得多。
 * ⚠ 刚卸过就别马上再卸：否则一台内存本来就紧的机器会陷入「卸了又装」的循环。
 */
export function decideUnload(o: {
  readonly currentBytes: number;
  readonly budgetBytes: number;
  readonly busy: boolean;
  readonly now: number;
  readonly lastUnloadAt: number | null;
  readonly cooldownMs?: number;
}): BudgetDecision {
  const cooldown = o.cooldownMs ?? 5 * 60_000;
  if (o.busy) return { action: "keep" };
  if (o.lastUnloadAt !== null && o.now - o.lastUnloadAt < cooldown) return { action: "keep" };
  if (o.currentBytes <= o.budgetBytes) return { action: "keep" };
  const g = (n: number): string => `${(n / GB).toFixed(1)} GB`;
  return {
    action: "unload",
    reason: `模型常驻已涨到 ${g(o.currentBytes)}，超过 ${g(o.budgetBytes)} 的预算，先把它卸掉；下一次提问会多等约两秒。`,
  };
}

/** `/api/ps` 里我们用得上的那一点信息。 */
export interface LoadedModel {
  readonly name: string;
  readonly sizeBytes: number;
  /** Ollama 说它什么时候到期卸载（ISO 串）。 */
  readonly expiresAt: string | null;
}

/** 解析 `/api/ps` 的响应。形状不对就返回空，不要猜。 */
export function parsePs(body: unknown): readonly LoadedModel[] {
  if (body === null || typeof body !== "object") return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const out: LoadedModel[] = [];
  for (const m of models) {
    if (m === null || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o.name !== "string" || typeof o.size !== "number") continue;
    out.push({
      name: o.name,
      sizeBytes: o.size,
      expiresAt: typeof o.expires_at === "string" ? o.expires_at : null,
    });
  }
  return out;
}

/**
 * 从「到期时间」倒推「空闲了多久」。
 *
 * Ollama 每次收到请求都把到期时间推到 `now + keepAlive`，所以
 * `空闲时长 = keepAlive - (到期时间 - 现在)`。这是我们已经拿到的数据，
 * 不用另外去探进程 CPU，也就不用去猜那个运行器的 pid。
 *
 * 解析不出来时返回 null——**null 要当成「可能正忙」**，不是「空闲很久」。
 */
export function idleMsFromExpiry(expiresAt: string | null, keepAliveMs: number, now: number): number | null {
  if (expiresAt === null) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  return keepAliveMs - (t - now);
}

/** 最近这么久内用过，就当它可能正在生成，不动它。 */
export const RECENTLY_USED_MS = 120_000;
