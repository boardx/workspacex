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
