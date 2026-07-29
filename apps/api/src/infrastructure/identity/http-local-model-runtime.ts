/**
 * The local inference runtime, over HTTP to a loopback endpoint (F16).
 *
 * ## Why a real HTTP client and not an in-process fake
 *
 * The claim being made is about the NETWORK. A fake that returns a string proves the use
 * case's branching and nothing about whether a socket opened, which is the only thing V3
 * asks. With a real client, the zero-egress assertion is made against code that genuinely
 * tries to connect -- so the guard is exercised rather than described.
 *
 * ## Why `LOCAL_RUNTIME_ENDPOINT` is validated at construction
 *
 * A misconfigured endpoint is the cheapest possible way to break the promise: point this at
 * a hosted API and every "local" call is a cloud call, with the whole feature still reporting
 * success. The constructor refuses anything that is not loopback, using the SAME predicate
 * the contract exposes to the frontend and migration 0012 enforces in the database -- three
 * enforcement points, one rule.
 */
import http from "node:http";
import { isLocalEndpoint } from "../../domain/identity/local-org";
import type { LocalModelRuntime } from "../../application/identity/local-org-ports";

/** Ollama's default. Configurable, but never off-machine. */
export const DEFAULT_LOCAL_RUNTIME_ENDPOINT = "http://127.0.0.1:11434";

export function localRuntimeEndpoint(): string {
  return process.env.LOCAL_RUNTIME_ENDPOINT ?? DEFAULT_LOCAL_RUNTIME_ENDPOINT;
}

export class HttpLocalModelRuntime implements LocalModelRuntime {
  readonly endpoint: string;

  constructor(endpoint: string = localRuntimeEndpoint()) {
    if (!isLocalEndpoint(endpoint)) {
      // Fails at construction, i.e. at boot, not on the first user request. A process that
      // cannot honour the promise must not start serving personal-local organizations at all.
      throw new Error(
        `LOCAL_RUNTIME_ENDPOINT must be a loopback address (got ${endpoint}) -- ` +
          "a personal-local organization's promise cannot be delegated off this machine",
      );
    }
    this.endpoint = endpoint;
  }

  async probe(): Promise<{ available: boolean; detail: string }> {
    try {
      await this.request("GET", "/", undefined, 1500);
      return { available: true, detail: "local runtime responded" };
    } catch (e) {
      // "Down" is an ANSWER here, not an exception: the caller renders a dependency-failure
      // state from it. Only the detail line carries the cause, and it goes to the operator.
      return { available: false, detail: describe(e) };
    }
  }

  async complete(prompt: string): Promise<string> {
    // No retry, no fallback endpoint, no "if this fails try the other one". The absence is
    // the feature: every one of those is a place a cloud call could be added later and still
    // read as local-first.
    return this.request("POST", "/api/generate", JSON.stringify({ prompt }), 30_000);
  }

  private request(method: string, path: string, body: string | undefined, timeoutMs: number): Promise<string> {
    const url = new URL(path, this.endpoint);
    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        { method, hostname: url.hostname, port: url.port, path: url.pathname, timeout: timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        },
      );
      req.on("timeout", () => req.destroy(new Error("local runtime timed out")));
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}

/** Cause, without a stack: the operator needs "connection refused", not our file layout. */
function describe(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code ? `local runtime unreachable (${code})` : "local runtime unreachable";
}
