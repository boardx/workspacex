import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A per-workspace private key stays outside the public runtime/document source. */
export function browserProof(key: string, publicationToken: string, existing?: string): string {
  if (existing && browserProofHash(key, publicationToken, existing)) return existing;
  const id = randomBytes(32).toString('hex');
  return `${id}.${signature(key, publicationToken, id)}`;
}
function signature(key: string, token: string, id: string) {
  return createHmac('sha256', key).update(`survey-browser:${token}:${id}`).digest('hex');
}
export function browserProofHash(key: string, token: string, proof?: string): string | null {
  const parts = proof?.split('.');
  if (!parts || parts.length !== 2 || !parts.every(part => /^[a-f0-9]{64}$/.test(part))) return null;
  if (!timingSafeEqual(Buffer.from(parts[1]!, 'hex'), Buffer.from(signature(key, token, parts[0]!), 'hex'))) return null;
  return createHash('sha256').update(proof!).digest('hex');
}
