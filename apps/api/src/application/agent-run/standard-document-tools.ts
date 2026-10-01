import type {z} from 'zod';
import type {DocumentParseInput,DocumentParseOutput} from '@repo/contracts/standard-document-tools';
import type {schemas} from '@repo/contracts/sandbox-session';
import type {ExecutionAuthorityContext} from './tool-execution-authority';
export const STANDARD_DOCUMENT_SERVICE=Symbol('StandardDocumentService');
export type DocumentContext=ExecutionAuthorityContext&{readonly bindingId:string};
export interface StandardDocumentService {parse(context:DocumentContext,input:z.infer<typeof DocumentParseInput>):Promise<z.infer<typeof DocumentParseOutput>>;}
export interface DocumentSession {
 read(path:string):Promise<unknown>;
 execute(input:z.infer<typeof schemas.execute>):Promise<z.infer<typeof schemas.result>>;
}

/** Internal diagnostics only; never include original errors, document content or identities. */
export class DocumentParseExecutionError extends Error {
 constructor(readonly reason: 'execution_mismatch'|'execution_timeout'|'execution_cancelled'|'execution_truncated'|'execution_failed') {
  super('document_parse_failed_no_replay');
 }
}
const DOCUMENT_FAILURE_REASONS = {
 document_parse_unavailable: 'runtime_unavailable',
 document_parse_denied: 'denied',
 document_parse_input_not_bound: 'input_not_bound',
 document_parse_input_changed: 'input_changed',
 document_parse_format_unsupported: 'format_unsupported',
 document_ocr_format_unsupported: 'format_unsupported',
 document_structure_format_unsupported: 'format_unsupported',
 document_parse_output_invalid: 'output_invalid',
 document_parse_empty: 'empty',
 document_ocr_empty: 'empty',
 document_structure_invalid: 'structure_invalid',
 document_ocr_structure_invalid: 'structure_invalid',
} as const;
export function documentParseFailureReason(error: unknown): string {
 if(error instanceof DocumentParseExecutionError)return error.reason;
 if(!(error instanceof Error))return 'unknown';
 return Object.hasOwn(DOCUMENT_FAILURE_REASONS,error.message)
  ? DOCUMENT_FAILURE_REASONS[error.message as keyof typeof DOCUMENT_FAILURE_REASONS] : 'unknown';
}
