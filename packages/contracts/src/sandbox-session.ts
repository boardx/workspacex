import { z } from "zod";

export const limits = {
  maxFiles: 256, maxDirectoryEntries: 4096, maxFileBytes: 8 * 1024 * 1024, maxSkillsBytes: 16 * 1024 * 1024,
  maxCommandBytes: 64 * 1024, maxOutputBytes: 64 * 1024, maxSessions: 16, maxExecutionsPerSession: 128,
  defaultTtlMs: 900000, maxTtlMs: 3600000, defaultTimeoutMs: 120000, maxTimeoutMs: 300000,
  maxRequestBytes: 24 * 1024 * 1024,
} as const;
const Path = z.string().min(1).max(4096);
const File = z.object({ path: Path, contentBase64: z.string().max(4 * Math.ceil(limits.maxFileBytes / 3)) }).strict();
const ExecutionId = z.string().uuid();
export const schemas = {
  create: z.object({ skills: z.array(File).max(limits.maxFiles).default([]), inputs: z.array(File).max(limits.maxFiles).default([]), ttlMs: z.number().int().min(1).max(limits.maxTtlMs).optional() }).strict(),
  created: z.object({ sessionId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int() }).strict(),
  write: File,
  written: z.object({ path: Path, sizeBytes: z.number().int().nonnegative() }).strict(),
  read: z.object({ path: Path }).strict(),
  file: File.extend({ sizeBytes: z.number().int().nonnegative() }).strict(),
  entries: z.object({ entries: z.array(z.object({ path: Path, isDirectory: z.boolean(), sizeBytes: z.number().int().nonnegative() }).strict()) }).strict(),
  execute: z.object({ executionId: ExecutionId, command: z.string().min(1).max(limits.maxCommandBytes), timeoutMs: z.number().int().min(1).max(limits.maxTimeoutMs).optional() }).strict(),
  result: z.object({ executionId: ExecutionId, exitCode: z.number().int().nullable(), output: z.string(), truncated: z.boolean(), timedOut: z.boolean(), cancelled: z.boolean() }).strict(),
  cancelled: z.object({ cancelled: z.boolean() }).strict(),
  deleted: z.object({ deleted: z.literal(true) }).strict(),
} as const;
/** UDS/private gateway transport. Per-session Bearer is never passed to executed code. */
export const endpoints = {
  create: "POST /sessions", write: "POST /sessions/:sessionId/files",
  read: "GET /sessions/:sessionId/files?path=...", list: "GET /sessions/:sessionId/entries?path=...",
  execute: "POST /sessions/:sessionId/executions", cancel: "POST /sessions/:sessionId/executions/:executionId/cancel",
  destroy: "DELETE /sessions/:sessionId",
} as const;
