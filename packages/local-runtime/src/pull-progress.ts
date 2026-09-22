/**
 * 拉模型时把进度说出来——首次启动最长的一段等待，不能是一块不动的屏幕。
 *
 * 2026-09-22 用户实测：首次启动停在「检查本地模型」七分钟，屏幕上没有任何东西在变，
 * 用户的原话是「这个正常吗？」。那一次的根因（多拉了一个用不上的 2.6 GB 模型）已经修掉，
 * 但**拉取本身仍然要好几分钟**——第一次装机必然要下三个多 GB 的聊天模型。
 * 一个正常的 app 在这种时候会告诉你下到哪儿了。
 *
 * `ollama pull` 的 CLI 输出是给终端看的（回车重绘同一行），解析它不稳当；
 * `POST /api/pull` 的 NDJSON 流才是给程序看的那一份，字段是
 * `{status, digest?, total?, completed?}`。
 */

export interface PullProgress {
  readonly status: string;
  readonly completedBytes: number | null;
  readonly totalBytes: number | null;
}

/** NDJSON 的一行 → 进度。认不出来的行返回 null（Ollama 会夹杂纯状态行）。 */
export function parsePullLine(line: string): PullProgress | null {
  const t = line.trim();
  if (t === "") return null;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.error === "string") throw new Error(o.error);
  if (typeof o.status !== "string") return null;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
  return { status: o.status, completedBytes: num(o.completed), totalBytes: num(o.total) };
}

const GB = 1024 ** 3;

/**
 * 进度行的文案。**没有总量时不编一个百分比**——Ollama 在 manifest 阶段就没有 total，
 * 那时候说「0%」是假的，说「正在获取清单」是真的。
 */
export function describePull(model: string, p: PullProgress): string {
  if (p.totalBytes !== null && p.totalBytes > 0 && p.completedBytes !== null) {
    const pct = Math.min(100, Math.floor((p.completedBytes / p.totalBytes) * 100));
    return `[ollama] 拉取 ${model} ${pct}%（${(p.completedBytes / GB).toFixed(1)}/${(p.totalBytes / GB).toFixed(1)} GB）`;
  }
  return `[ollama] 拉取 ${model}：${p.status}`;
}

/** 两条进度行之间的最小间隔：日志是给人看的，一秒刷几十行等于没写。 */
export const PULL_LOG_INTERVAL_MS = 1500;

/** 该不该把这一条写进日志：内容变了且间隔到了，或者这是最后一条。 */
export function shouldLogPull(
  prev: { readonly text: string; readonly at: number } | null,
  text: string,
  now: number,
  intervalMs: number = PULL_LOG_INTERVAL_MS,
): boolean {
  if (prev === null) return true;
  if (prev.text === text) return false;
  return now - prev.at >= intervalMs;
}

/**
 * 走 `POST /api/pull` 的流式拉取，边拉边把进度交给 `log`。
 * 返回拉取是否成功；失败时把最后一条状态一并带出，调用方决定怎么报。
 */
export async function pullModelWithProgress(
  ollamaUrl: string,
  model: string,
  log: (line: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
    });
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok || res.body === null) return { ok: false, detail: `HTTP ${res.status}` };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let last: { text: string; at: number } | null = null;
  let lastStatus = "";
  let pending: string | null = null;   // 被节流挡下来的最后一条，收尾时补写
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const p = parsePullLine(line);
        if (p === null) continue;
        lastStatus = p.status;
        const text = describePull(model, p);
        const now = Date.now();
        if (shouldLogPull(last, text, now)) {
          log(text);
          last = { text, at: now };
          pending = null;
        } else if (p.status !== "success" && (last === null || last.text !== text)) {
          // 节流挡下来的这一条不能就这么丢：它可能正好是拉取结束前的最后一次进度，
          // 丢了它，日志里最后看到的就是一个偏旧的百分比。
          // 但 `success` 不算进度——让它进 pending 会把真正的最后一条百分比顶掉，
          // 用户看到的收尾变成「…：success」而不是「…100%（3.1/3.1 GB）」。
          pending = text;
        }
      }
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  // Ollama 成功收尾时最后一条是 status: "success"。收不到它就是没拉完。
  if (lastStatus !== "success") {
    if (pending !== null) log(pending);
    return { ok: false, detail: lastStatus || "流意外结束" };
  }
  if (pending !== null) log(pending);
  log(`[ollama] 拉取 ${model} 完成`);
  return { ok: true };
}
