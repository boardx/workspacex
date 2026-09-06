import { z } from 'zod';
import { TrustedMemoryScope, MEMORY_SCOPE_CONFIG_KEY } from './standard-capabilities';

export { TrustedMemoryScope, MEMORY_SCOPE_CONFIG_KEY };
export const MEMORY_LIMITS = { text: 8000, pageSize: 25, maxItems: 256, databaseTimeoutMs: 15000, maxConcurrentOperations: 16 } as const;
const id = z.string().min(1).max(256);
export const MemorySourceRef = z.object({ threadId: id, messageId: id }).strict();
export const MemorySearchInput = z.object({ query: z.string().max(256).optional(), cursor: z.string().regex(/^\d{1,4}$/).optional() }).strict();
export const MemoryWriteInput = z.object({ text: z.string().min(1).max(MEMORY_LIMITS.text), sourceMessageId: id,
  memoryId: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
export const MemoryDeleteInput = z.object({ memoryId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const MemoryItem = z.object({ memoryId: z.string().uuid(), text: z.string().min(1).max(MEMORY_LIMITS.text),
  revision: z.number().int().positive(), sourceRef: MemorySourceRef, updatedAt: z.string().datetime() }).strict();
export const MemorySearchOutput = z.object({ mode: z.literal('literal'), items: z.array(MemoryItem).max(MEMORY_LIMITS.pageSize),
  cursor: z.string().optional() }).strict();
export const MemoryWriteOutput = z.object({ memoryId: z.string().uuid(), revision: z.number().int().positive() }).strict();
export const MemoryDeleteOutput = z.object({ deleted: z.literal(true) }).strict();
export const MemoryFailure = z.enum(['memory_revision_conflict','memory_idempotency_conflict','memory_revision_required','memory_limit']);
export const MemoryProofInput = z.object({ orgId: id, userId: id, attemptId: id, leaseEpoch: z.number().int().positive(),
  toolCallId: id, permissionRequestId: z.string().uuid().optional(),
  toolName: z.enum(['wx_memory_search','wx_memory_write','wx_memory_delete']),
  toolArgs: z.union([MemorySearchInput, MemoryWriteInput, MemoryDeleteInput]),
  sources: z.array(MemorySourceRef).max(MEMORY_LIMITS.maxItems) }).strict();
export const MemoryProofOutput = z.object({ scope: TrustedMemoryScope, sourceRef: MemorySourceRef.optional(),
  visible: z.array(MemorySourceRef).max(MEMORY_LIMITS.maxItems) }).strict();
