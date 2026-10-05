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
import {randomUUID} from "node:crypto";
import {Logger} from "@nestjs/common";
import type {LocalRequestAccounting,LocalModelAccountingContext} from "../../application/identity/local-request-accounting";
import type {ReportedUsage} from "../../application/agent-run/ports";
import { isLocalEndpoint } from "../../domain/identity/local-org";
import type { LocalModelRuntime } from "../../application/identity/local-org-ports";

/** Ollama's default. Configurable, but never off-machine. */
export const DEFAULT_LOCAL_RUNTIME_ENDPOINT = "http://127.0.0.1:11434";

export function localRuntimeEndpoint(): string {
  return process.env.LOCAL_RUNTIME_ENDPOINT ?? DEFAULT_LOCAL_RUNTIME_ENDPOINT;
}

/**
 * Ollama's `/api/generate` refuses a request without `model` (HTTP 400) and streams NDJSON
 * unless `stream:false` -- the first cut sent `{ prompt }` alone and returned the raw body, so
 * a personal-local completion could never have produced text (#3749 B1.5). The model is the
 * one the local build serves (`KERNEL_MODEL_ID`), overridable per runtime.
 */
export function localRuntimeModelId(env: NodeJS.ProcessEnv = process.env): string {
  return (env.LOCAL_RUNTIME_MODEL_ID ?? env.KERNEL_MODEL_ID ?? "").trim();
}

export class HttpLocalModelRuntime implements LocalModelRuntime {
  private accountingFault=false;
  private readonly logger=new Logger(HttpLocalModelRuntime.name);
  readonly endpoint: string;
  readonly modelId: string;

  constructor(endpoint: string = localRuntimeEndpoint(), modelId: string = localRuntimeModelId(),private readonly accounting?:LocalRequestAccounting,private readonly productQuotaEnabled=false) {
    this.modelId = modelId;
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

  async complete(prompt: string,context?:LocalModelAccountingContext): Promise<string> {
    if(this.accountingFault)throw new Error("LOCAL_ACCOUNTING_REPAIR_REQUIRED");
    if(this.productQuotaEnabled)throw new Error("LOCAL_MODEL_ADMISSION_REQUIRED");
    if(this.accounting&&!context)throw new Error("LOCAL_ACCOUNTING_CONTEXT_REQUIRED");
    context?.signal?.throwIfAborted();
    const receipt=this.accounting?await this.accounting.start(context!,{requestId:randomUUID(),modelId:this.modelId,startedAt:new Date().toISOString()}):undefined;
    let usage:ReportedUsage={},outcome:"succeeded"|"failed"="failed";
    try {
    // No retry, no fallback endpoint, no "if this fails try the other one". The absence is
    // the feature: every one of those is a place a cloud call could be added later and still
    // read as local-first.
    const raw = await this.request(
      "POST", "/api/generate",
      JSON.stringify({ model: this.modelId, prompt, stream: false }),
      120_000,context?.signal,receipt?(status,raw)=>{usage=readLocalUsage(raw);if(status>=200&&status<300)outcome="succeeded";}:undefined,
    );
    // `{ "response": "..." }` on success; anything else (an `error` object, a non-JSON body) is
    // surfaced verbatim so the operator sees what the runtime actually said.
    try {
      const parsed = JSON.parse(raw) as { response?: unknown; error?: unknown };
      if (typeof parsed.response === "string") return parsed.response;
      if (parsed.error !== undefined) {outcome="failed";throw new Error(`local runtime error: ${String(parsed.error)}`);}
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("local runtime error")) throw e;
    }
    return raw;
    } finally {
      if(receipt)try{await receipt.terminal({endedAt:new Date().toISOString(),outcome,usage});}catch{this.accountingFault=true;this.logger.warn("LOCAL_USAGE_TERMINAL_FAILED: unmatched durable start; subsequent inference blocked in this instance");}
    }
  }

  private request(method: string, path: string, body: string | undefined, timeoutMs: number,signal?:AbortSignal,received?:(status:number,raw:string)=>void): Promise<string> {
    const url = new URL(path, this.endpoint);
    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        { method, hostname: url.hostname, port: url.port, path: url.pathname, timeout: timeoutMs,signal },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("error",reject);
          res.on("aborted",()=>reject(new Error("local runtime response aborted")));
          res.on("end", () => {const raw=Buffer.concat(chunks).toString("utf8");received?.(res.statusCode??0,raw);resolve(raw);});
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

/** Original Ollama counters only. No total, native unit or free price is inferred. */
export function readLocalUsage(raw:string):ReportedUsage{
 try{const u=JSON.parse(raw) as Record<string,unknown>,count=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0?v:undefined;
  return Object.fromEntries(Object.entries({prompt:count(u.prompt_eval_count),completion:count(u.eval_count)}).filter(([,v])=>v!==undefined));
 }catch{return {};}
}
