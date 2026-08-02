/**
 * F60 -- UC-4.4 阶段一：tool-call 四要素写入 + 命名空间可区分（I-20）+
 * 「没有留痕就没有调用」硬前置（I-44 / AC6）。
 *
 * `user_visible_behavior`: 「每次工具调用留 函数签名+参数+命中数/结果量+运行态 四要素，
 * 内建工具（graph./brain.）与 MCP 工具（mcp:<服务器>.<工具>）命名空间可区分；tool-call
 * 写入失败则该次调用必须失败（没有留痕就没有调用）。」
 *
 * ## Why namespace classification is NOT reinvented here
 * F52 already shipped `isReservedToolFullName` / `parseMcpToolFullName` in
 * `@repo/contracts`'s `agent-runtime` module as the machine-checked home of I-20 ("全名恒为
 * `mcp:<服务器>.<工具>`，与内建 `graph.`/`brain.` 命名空间可区分"). This module is a thin
 * wrapper that turns those two predicates into a single closed classification (`ToolNamespace`)
 * so callers get a `null` for "neither" instead of having to remember to check both functions
 * and reason about what it means if neither matches.
 *
 * ## Why "write failure -> call failure" is a thrown error, not a `{ ok: false }` return
 * A function that returns `{ ok: false }` on audit failure still hands the caller a value they
 * *could* choose to treat as "the call happened, audit just didn't." Throwing removes that
 * branch entirely -- there is no code path in which a caller receives a `recordId` without the
 * write having actually succeeded, matching contract's own choice (`recordToolCall.err =
 * ["PROVENANCE_WRITE_FAILED"]`, not an `ok` field in `out`).
 */
import { agentRuntime as A } from "@repo/contracts";
import type { z } from "zod";

export type RecordToolCallInput = z.infer<typeof A.operations.recordToolCall.in>;
export type RecordToolCallOutput = z.infer<typeof A.operations.recordToolCall.out>;

/** What the classification distinguishes -- exactly the two things I-20 requires distinguishable. */
export type ToolNamespace =
  | { readonly kind: "builtin"; readonly prefix: "graph." | "brain." }
  | { readonly kind: "mcp"; readonly serverSlug: string; readonly toolName: string };

/**
 * Classify a tool signature into the closed namespace split I-20 requires.
 * `null` = neither a reserved builtin prefix nor a well-formed `mcp:<server>.<tool>` full name --
 * such a signature must never reach `recordToolCall`'s write path (see below).
 */
export function classifyToolNamespace(signature: string): ToolNamespace | null {
  if (A.isReservedToolFullName(signature)) {
    const prefix = A.RESERVED_TOOL_NAMESPACE_PREFIXES.find((p) => signature.startsWith(p));
    if (prefix === undefined) return null;
    return { kind: "builtin", prefix };
  }
  const parsed = A.parseMcpToolFullName(signature);
  if (parsed !== null) {
    return { kind: "mcp", serverSlug: parsed.serverSlug, toolName: parsed.toolName };
  }
  return null;
}

/** Port the application layer implements over `provenance_events` (append-only, I-45). */
export interface ProvenanceWriter {
  write(input: RecordToolCallInput): { readonly ok: boolean; readonly recordId?: string };
}

/** Thrown when the audit write fails -- mirrors `AgentRuntimeError` member `PROVENANCE_WRITE_FAILED`. */
export class ProvenanceWriteFailedError extends Error {
  constructor(message = "PROVENANCE_WRITE_FAILED") {
    super(message);
    this.name = "ProvenanceWriteFailedError";
  }
}

/** Thrown when a signature is neither a reserved builtin prefix nor a legal MCP full name. */
export class ToolNamespaceUnclassifiableError extends Error {
  constructor(signature: string) {
    super(
      `工具签名「${signature}」既不是内建命名空间（graph./brain.）也不是合法的 mcp:<服务器>.<工具>`,
    );
    this.name = "ToolNamespaceUnclassifiableError";
  }
}

/**
 * The single write path for a tool-call's four elements (signature, params, hitCount, runState)
 * plus the O-22⑤ / I-48 provenance fields (agentVersion / skillVersion / modelId /
 * permissionSnapshot -- already required, non-optional, on `RecordToolCallInput` by the
 * contract itself, so there is no separate validation step for those here).
 *
 * ⚠ I-44 / AC6: if `writer.write` reports failure (or omits `recordId`), this function throws
 * `ProvenanceWriteFailedError` -- there is no return value a caller could mistake for success.
 */
export function recordToolCall(
  input: RecordToolCallInput,
  writer: ProvenanceWriter,
): RecordToolCallOutput {
  const namespace = classifyToolNamespace(input.signature);
  if (namespace === null) {
    throw new ToolNamespaceUnclassifiableError(input.signature);
  }

  const result = writer.write(input);
  if (!result.ok || result.recordId === undefined) {
    throw new ProvenanceWriteFailedError();
  }
  return { recordId: result.recordId };
}
