import {z} from 'zod';
import {MCP_EXECUTION_LIMITS as L} from './mcp-runtime-snapshot';
/** Infrastructure-only row returned by the dedicated DB function. Never a tool or HTTP response schema. */
export const McpSealedExecutionEnvelope=z.object({ciphertext:z.string().min(1).max(L.maxCredentialBytes*2+58),algorithm:z.literal('aes-256-gcm'),key_id:z.string(),revision:z.string().uuid(),endpoint:z.string()}).strict();
