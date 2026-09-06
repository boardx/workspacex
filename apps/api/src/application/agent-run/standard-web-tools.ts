import type {z} from 'zod';
import type {WebSearchInput,WebSearchOutput,FetchUrlInput,FetchUrlOutput} from '@repo/contracts/standard-web-tools';
export const STANDARD_WEB_SERVICE=Symbol('StandardWebService');
export interface StandardWebService {
 search(input:z.infer<typeof WebSearchInput>):Promise<z.infer<typeof WebSearchOutput>>;
 fetch(input:z.infer<typeof FetchUrlInput>):Promise<z.infer<typeof FetchUrlOutput>>;
}
