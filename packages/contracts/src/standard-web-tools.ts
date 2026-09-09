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
/**
 * issue #3204 ② —— 失败原因必须可分辨。
 *
 * 人类实测 `fetch_url https://openai.com/index/navier-stokes-solution/`，工具只回一句
 * 「Web source unavailable or refused; no content confirmed.」。实测取证（curl 直连，
 * 默认 UA 与浏览器 UA 各一次）：上游是 `HTTP/2 403` + `cf-mitigated: challenge` +
 * `server: cloudflare` —— **上游真拒绝**，产品行为正确。但那句话把三件完全不同的事
 * （被拒 / 不可达 / 超时 / 被出站策略挡下）压成同一句，agent 与用户都无法判断
 * 「该不该换源」「该不该重试」。
 *
 * 原因此前被压平了三次：`standard-web-fetch` 丢掉状态码、控制器一个 `catch{}` 吞掉
 * 所有成因、Python 侧把任意 503 映射成同一句话。这个枚举是那三处共用的**单一**来源，
 * 经 `generated/standard_web_schema.json` 下发给 Python，不留第二份措辞。
 *
 * ⚠ 只回枚举 + 数字状态码，**绝不**回上游正文或响应头——`test_standard_web_unavailable.py`
 *   钉着"上游敏感内容不得出现在 ToolMessage 里"，这条纪律不因可分辨而放宽。
 * ⚠ 这里没有放宽任何出站策略：`blocked_by_policy` 只是把"被我们自己的门挡下"如实说出来。
 */
export const StandardWebFailureReason=z.enum(['upstream_refused','upstream_unreachable','timeout','blocked_by_policy','unsupported_content','no_content','too_large','unknown']);
/** 给模型看的措辞——单一事实源，Python 侧只做 `{status}` 替换，不另写一份。 */
export const STANDARD_WEB_FAILURE_GUIDANCE={
 upstream_refused:'The site refused this request (HTTP {status}); the page may exist but the server declined automated access. Retrying will not help. Do not cite this source; choose another authorized public source.',
 upstream_unreachable:'The site could not be reached (DNS or connection failure); no response was received. Do not cite this source; choose another authorized public source.',
 timeout:'The request timed out before the site responded; no content was received. One retry is reasonable, otherwise choose another authorized public source.',
 blocked_by_policy:'This URL was blocked by the outbound access policy, not by the site. Retrying the same URL will not help; choose another authorized public source.',
 unsupported_content:'The response was not HTML or UTF-8 text, so no content could be read. Do not cite this source; choose another authorized public source.',
 no_content:'The site responded but no readable text could be extracted (often a script-only or interstitial page). Do not cite this source; choose another authorized public source.',
 too_large:'The response exceeded the size limit and was discarded; no content confirmed. Do not cite this source; choose another authorized public source.',
 unknown:'Web source unavailable or refused; no content confirmed. Do not cite this failed source. You may choose another authorized public source.',
} as const satisfies Record<z.infer<typeof StandardWebFailureReason>,string>;
export const StandardWebFailureBody=z.object({error:z.literal('standard_web_unavailable_or_refused'),reason:StandardWebFailureReason,upstreamStatus:z.number().int().min(100).max(599).optional()}).strict();
export const STANDARD_WEB_TOOLS={web_search:{input:WebSearchInput,output:WebSearchOutput},fetch_url:{input:FetchUrlInput,output:FetchUrlOutput}} as const;
