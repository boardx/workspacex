import type { z } from 'zod';
import type { ReportFileSourceKind as SourceKindSchema } from '@repo/contracts/report-files';
import type { OrgId } from '../../domain/org-id';

export type ReportFileSourceKind = z.infer<typeof SourceKindSchema>;
export type ReportFileActor = { readonly orgId: OrgId; readonly userId: string };
/** Server-owned canonical report; neither identity, evidence nor approval comes from the client. */
export interface ReportFileSourceSnapshot {
  readonly kind: ReportFileSourceKind;
  readonly id: string;
  readonly title: string;
  readonly reportVersion: number;
  /** SHA256 of exactly markdown, verified against the stored report where available. */
  readonly reportHash: string;
  /** Full durable identity, including revision/document IDs to prevent ABA. */
  readonly bindingKey: string;
  readonly markdown: string;
  /** Authorized saved locators/quotes only; excluded from canonical reportHash. */
  readonly appendixMarkdown?: string;
  readonly projectId: string | null;
  readonly notices: readonly string[];
}
export interface ReportFileSourceResolver {
  readonly kind: ReportFileSourceKind;
  read(actor: ReportFileActor, id: string): Promise<ReportFileSourceSnapshot>;
}
export const REPORT_FILE_SOURCE_RESOLVERS = Symbol('ReportFileSourceResolvers');
export const REPORT_FILE_SOURCE_ERROR_CODES = [
  'REPORT_NOT_FOUND', 'REPORT_UNAVAILABLE', 'REPORT_CHANGED',
] as const;
export class ReportFileSourceError extends Error {
  constructor(readonly code: typeof REPORT_FILE_SOURCE_ERROR_CODES[number]) { super(code); }
}
