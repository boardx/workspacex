import { createHash } from 'node:crypto';
/** Trusted server identity only. Never accept this metadata from script/model arguments. */
export function sandboxOwnerKey(orgId: string, userId: string | null): string {
  return createHash('sha256').update(JSON.stringify([orgId, userId])).digest('hex');
}
