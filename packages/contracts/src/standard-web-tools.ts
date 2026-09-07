import { z } from 'zod';
import { NativeSessionResolveInput } from './native-session-binding';
export const STANDARD_WEB_LIMITS = { deadlineMs:10000, parseDeadlineMs:5000, maxBodyBytes:1048576, maxTextChars:60000, maxResults:5, maxResponseBytes:524288, maxElements:50000, maxParseWorkers:2, maxSnippetChars:8000 } as const;
const domain=z.string().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/);
export const WebSearchInput=z.object({query:z.string().min(1).max(2000).regex(/\S/),domains:z.array(domain).max(10).optional(),limit:z.number().int().min(1).max(STANDARD_WEB_LIMITS.maxResults).optional(),timeRange:z.literal('all').optional()}).strict();
export const FetchUrlInput=z.object({url:z.string().url().max(4096)}).strict();
const source=z.object({sourceId:z.string().regex(/^web:[a-f0-9]{64}$/),url:z.string().url(),retrievedAt:z.string().datetime(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)});
export const WebSearchOutput=z.object({results:z.array(source.extend({title:z.string().max(1000),snippet:z.string().max(30000)})).max(STANDARD_WEB_LIMITS.maxResults),truncated:z.boolean(),provider:z.literal('boardx-google'),candidateLimit:z.literal(STANDARD_WEB_LIMITS.maxResults),domainFilter:z.literal('post-filter-provider-candidates'),contentKind:z.literal('search-snippet')}).strict();
export const FetchUrlOutput=source.extend({resolvedUrl:z.string().url(),title:z.string().max(1000),text:z.string().max(STANDARD_WEB_LIMITS.maxTextChars),truncated:z.boolean(),contentKind:z.literal('extracted-text'),extractor:z.enum(['mozilla-readability','utf8-text']),hashScope:z.literal('full-extracted-text')}).strict();
const identity=NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional()});
export const StandardWebInvocation=z.discriminatedUnion('toolName',[
 identity.extend({toolName:z.literal('web_search'),toolArgs:WebSearchInput}).strict(),
 identity.extend({toolName:z.literal('fetch_url'),toolArgs:FetchUrlInput}).strict(),
]);
export const STANDARD_WEB_TOOLS={web_search:{input:WebSearchInput,output:WebSearchOutput},fetch_url:{input:FetchUrlInput,output:FetchUrlOutput}} as const;
