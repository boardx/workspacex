/**
 * Which Ollama do we talk to? Reusing whatever already listens on the port was fine until
 * thinking control mattered: `reasoning_effort: "none"` on `/v1` only works from Ollama 0.34
 * (measured 2026-09-17: 0.32.15 keeps reasoning; 0.34.1 answers a one-liner in 1.2 s instead of
 * 12-70 s). A user's older Ollama.app therefore makes every local reply several times slower,
 * so when it is too old and the bundle carries a newer binary we start ours on the next port.
 */
import { execFileSync } from "node:child_process";

/** First Ollama release whose OpenAI-compatible endpoint honours `reasoning_effort: "none"`. */
export const MIN_OLLAMA_VERSION = "0.34.0";

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function parseOllamaVersion(text: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

/** Version of a running server (`/api/version`), null when unreachable. */
export async function runningOllamaVersion(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? parseOllamaVersion(body.version) : null;
  } catch {
    return null;
  }
}

/** Version of a binary on disk. OLLAMA_HOST is pointed at a dead port so `--version` reports the client, not some running server. */
export function ollamaBinaryVersion(bin: string): string | null {
  try {
    const out = execFileSync(bin, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, OLLAMA_HOST: "127.0.0.1:1" }, timeout: 10_000 });
    return parseOllamaVersion(out);
  } catch {
    return null;
  }
}

/**
 * Decide between reusing a running Ollama and starting our own beside it.
 *
 * With a bundled binary that is new enough we ALWAYS serve from our own instance (on the
 * alternate port when the user's Ollama holds the default one): context length, keep-alive and
 * the model store are server-side settings we can only guarantee on a process we started
 * (#3749 B1.1 -- the user's Ollama.app auto-updated to 0.34.1 and silently took over with a
 * 4096-token context). A running instance on the alternate port is an earlier one of ours;
 * the caller restarts it so the current settings apply. Without a usable bundle we reuse
 * whatever runs, as before.
 */
export function chooseOllama(input: { running: string | null; binary: string | null; port: number; runningOnAlternate?: string | null }): { reuse: boolean; port: number; reason: string } {
  const bundleOk = input.binary !== null && compareVersions(input.binary, MIN_OLLAMA_VERSION) >= 0;
  if (input.running === null) return { reuse: false, port: input.port, reason: "no Ollama on the port; starting ours" };
  if (bundleOk) {
    const alt = input.port + 1;
    if (input.runningOnAlternate) {
      return { reuse: true, port: alt, reason: `Ollama ${input.running} holds ${input.port}; our earlier instance ${input.runningOnAlternate} is on ${alt}` };
    }
    return { reuse: false, port: alt, reason: `Ollama ${input.running} holds ${input.port}; starting bundled ${input.binary} on ${alt} (own context length / keep-alive / model store)` };
  }
  if (compareVersions(input.running, MIN_OLLAMA_VERSION) >= 0) return { reuse: true, port: input.port, reason: `reusing running Ollama ${input.running} (no bundled binary)` };
  return { reuse: true, port: input.port, reason: `reusing running Ollama ${input.running} (older than ${MIN_OLLAMA_VERSION}, replies will be slower: thinking cannot be switched off)` };
}
