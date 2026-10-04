import { wave2Runtime } from '@repo/contracts';

export function safeSkillImportFailure(body: unknown, status: number): string {
  let field: PropertyDescriptor | undefined;
  try { field = body !== null && typeof body === 'object' ? Object.getOwnPropertyDescriptor(body, 'reasonCode') : undefined; } catch { /* diagnostic-only: preserve the HTTP assertion */ }
  const value = field && 'value' in field ? field.value : undefined;
  const code = typeof value === 'string' && wave2Runtime.operations.importSkillFromUrl.err.some(known => known === value) ? value : 'UNKNOWN';
  return `SKILL_IMPORT_HTTP status=${status} reasonCode=${code}`;
}
