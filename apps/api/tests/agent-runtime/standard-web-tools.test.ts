import {afterEach,describe,it,expect} from 'vitest';
import https from 'node:https';
import dns from 'node:dns';
import {createHash} from 'node:crypto';
import {WebSearchInput,FetchUrlInput,STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
import {createStandardWebFetch} from '../../src/infrastructure/agent-run/standard-web-fetch';
import {DefaultStandardWebService} from '../../src/infrastructure/agent-run/standard-web-service';
import {extractStandardWebHtml} from '../../src/infrastructure/agent-run/standard-web-extractor';
import {GoogleGuidedSearch} from '../../src/infrastructure/research/google-guided-search';
import {assertResolvedMcpAddressAllowed} from '../../src/domain/mcp/remote-endpoint-guard';
import {classifyStandardWebFailure} from '../../src/domain/agent-run/standard-web-failure';
import {testTlsMaterial} from '../support/tls';
const servers:https.Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}});
const lookup=((host:string,options:{all?:boolean},cb:Function)=>options.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof dns.lookup;
async function fixture(handler:Parameters<typeof https.createServer>[1]){
 const server=https.createServer(testTlsMaterial(),handler);servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return `https://allowed.example:${(server.address() as {port:number}).port}`;
}
const localFetch=(timeout=10000)=>createStandardWebFetch({connectTimeoutMs:timeout,extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}});
const emptySearch={search:async()=>[]};
describe('standard web public fetch transport',()=>{
 it.each(['http://example.com','https://127.0.0.1','https://169.254.169.254/latest','https://[::1]','https://u:p@example.com','https://2130706433'])('refuses unsafe literal %s',async url=>{await expect(createStandardWebFetch()(url)).rejects.toThrow();});
 it('DNS rebinding is checked at the actual socket lookup, no connection reaches the target',async()=>{
  let reached=0;const url=await fixture((req,res)=>{reached++;res.end('private');});
  const guarded=createStandardWebFetch({connectTimeoutMs:500,extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:assertResolvedMcpAddressAllowed}});
  await expect(guarded(url)).rejects.toThrow();expect(reached).toBe(0);
 });
 it('redirect does not follow to metadata or another public endpoint',async()=>{
  let calls=0;const url=await fixture((req,res)=>{calls++;res.writeHead(302,{location:'https://169.254.169.254/'});res.end();});
  await expect(localFetch()(url)).rejects.toThrow();expect(calls).toBe(1);
 });
 it('oversize body is refused, not partial content success',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('x'.repeat(L.maxBodyBytes+1));});
  await expect(localFetch()(url)).rejects.toThrow('too_large'); // #3204 ②：同一件事换成枚举名 `too_large`
 });
 it('wall clock deadline stops a trickling body',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.write('a');const timer=setInterval(()=>res.write('b'),10);res.on('close',()=>clearInterval(timer));});
  const start=Date.now();await expect(localFetch(100)(url)).rejects.toThrow();expect(Date.now()-start).toBeLessThan(1500);
 });
 it('encoding and unsupported MIME are not invented plaintext',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'application/pdf'});res.end('not a web page');});
  const service=new DefaultStandardWebService(emptySearch,localFetch());await expect(service.fetch({url})).rejects.toThrow('unsupported_content'); // #3204 ②：同一件事换成枚举名 `unsupported_content`
 });
 it('real Readability worker extracts article without executing scripts or loading subresources',async()=>{
  let requests=0;const paragraph='This is an evidence-backed article with enough substantive content to identify the main article. '.repeat(12);
  const url=await fixture((req,res)=>{requests++;res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(`<html><head><title>真实来源</title></head><body><article><h1>真实来源</h1><p>${paragraph}</p><script>throw new Error('must not run');fetch('/secret')</script><img src='/tracking'/></article></body></html>`);});
  const output=await new DefaultStandardWebService(emptySearch,localFetch()).fetch({url});
  expect(output.title).toBe('真实来源');expect(output.text).toContain(paragraph);expect(output.text).not.toContain('must not run');expect(requests).toBe(1);
  expect(output.contentHash).toBe(createHash('sha256').update(output.text).digest('hex'));expect(output.extractor).toBe('mozilla-readability');
 });
 /**
  * issue #3439 附带发现（2026-09-11）—— jsdom 在 import 时无条件 `require("canvas")`
  * （见 jsdom/lib/jsdom/utils.js），只在拿到干净的 MODULE_NOT_FOUND 时才把 Canvas 置 null；
  * `canvas` 是原生 N-API 模块，且因 pnpm 默认 auto-install-peers 把 vitest→jsdom 的可选 peer
  * 工作区级装了进来（`apps/api/package.json` devDependencies.canvas + pnpm-lock.yaml），
  * 生产 API 从未用到它（这里只做纯文本抽取，没有 <canvas>/<img> 渲染）。若该原生二进制在
  * 目标平台 ABI 不匹配（常见于缺 libcairo 的 Linux 容器），在 worker_thread 里加载它会以
  * `FATAL ERROR: napi_throw` 硬崩整个进程——try/catch 拦不住。这条钉住修法本身：worker 里
  * 对 `canvas` 的 require 必须在 Module 解析层被拦截，jsdom 才会退化到官方文档的 no-canvas
  * 模式，而不是真的走到原生模块加载那一步。
  */
 it('canvas 原生模块从未在真实抽取 worker 里被加载',async()=>{
  const output=await extractStandardWebHtml('<html><body><article><p>足够长的正文以通过 Readability 的最小长度判定。'.repeat(20)+'</p></article></body></html>','https://example.com');
  expect(output.canvasBlocked).toBe(true);
 });
 it('worker deadline refuses pathological HTML rather than blocking the API event loop',async()=>{
  await expect(extractStandardWebHtml('<div>'.repeat(L.maxElements+1),'https://example.com')).rejects.toThrow();
 });
 it('concurrent parser capacity fails closed without an unbounded waiting queue',async()=>{
  const jobs=Array.from({length:L.maxParseWorkers},()=>extractStandardWebHtml('<div>'.repeat(L.maxElements+1),'https://example.com'));
  await expect(extractStandardWebHtml('<p>x</p>','https://example.com')).rejects.toThrow('parser_busy');
  await Promise.allSettled(jobs);
 });
 it('long text marks truncation and hashes full extracted text',async()=>{
  const body='中文'.repeat(L.maxTextChars);const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end(body);});
  const output=await new DefaultStandardWebService(emptySearch,localFetch()).fetch({url:url+'/#fragment'});
  expect(output.text.length).toBe(L.maxTextChars);expect(output.truncated).toBe(true);expect(output.url).not.toContain('#');expect(output.contentHash).toBe(createHash('sha256').update(body).digest('hex'));
 });
});
describe('existing Google search adaptation',()=>{
 it('real Google protocol, Unicode query, limit and domain post-filter retain source provenance',async()=>{
  let query='';const url=await fixture((req,res)=>{query=new URL(req.url!,'https://example.com').searchParams.get('q')!;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'Primary',url:'https://docs.example.com/a#anchor',snippet:'真正的片段'},{title:'Elsewhere',url:'https://other.example/b',snippet:'Other source'}]}));});
  const fetcher=localFetch(),service=new DefaultStandardWebService(new GoogleGuidedSearch(fetcher,url),fetcher);
  const output=await service.search({query:'中文 research',domains:['example.com'],limit:1,timeRange:'all'});
  expect(query).toBe('中文 research');expect(output.results).toHaveLength(1);expect(output.results[0]!.url).toBe('https://docs.example.com/a');expect(output.domainFilter).toBe('post-filter-provider-candidates');expect(output.candidateLimit).toBe(5);expect(output.contentKind).toBe('search-snippet');
 });
 /**
  * issue #3388 —— 一个不合出站策略的候选，不许把整次搜索炸掉。
  *
  * 真实链路取证（2026-09-11，上游 www.web-search.boardx.us）：人类那条
  * 「2026年新能源汽车销量最新数据」12/12 次全部失败，肇事者恒为
  * `http://www.caam.org.cn/tjsj`——中汽协官网只有 http，而这个话题下它必进前五。
  * 旧代码把它当成"整次搜索失败"，模型收到「Web source unavailable or refused」，
  * 于是换个措辞重搜——人类看到的「执行失败 · web_search → 已执行 · web_search」就是它。
  *
  * ⚠ 这条断言必须钉在**混合候选集**上。原有用例的候选全是 https，缺陷在那个形状下
  *   无法被证伪（本仓「替身产不出缺陷的形状」）。
  */
 it('one policy-refused candidate does not fail the whole search',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[
   {title:'CAAM',url:'http://www.caam.org.cn/tjsj',snippet:'中汽协 产销数据'},
   {title:'Usable',url:'https://docs.example.com/a',snippet:'可用来源'},
  ]}));});
  const fetcher=localFetch(),service=new DefaultStandardWebService(new GoogleGuidedSearch(fetcher,url),fetcher);
  const output=await service.search({query:'2026年新能源汽车销量最新数据'});
  expect(output.results.map(hit=>hit.url)).toEqual(['https://docs.example.com/a']);
  // 候选被裁过要如实告诉模型：不是"网上没有别的来源"。
  expect(output.truncated).toBe(true);
 });
 it('unsupported filters reject rather than silently ignoring',()=>{
  expect(WebSearchInput.safeParse({query:'x',timeRange:{from:'2026-01-01'}}).success).toBe(false);
  expect(WebSearchInput.safeParse({query:'x',limit:6}).success).toBe(false);
  expect(WebSearchInput.safeParse({query:'x',domains:['https://example.com']}).success).toBe(false);
  expect(FetchUrlInput.safeParse({url:'https://example.com',headers:{Authorization:'secret'}}).success).toBe(false);
 });
 it('upstream quota failure is failure, not empty results',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(429);res.end('secret provider quota detail');});
  const f=localFetch();await expect(new DefaultStandardWebService(new GoogleGuidedSearch(f,url),f).search({query:'x'})).rejects.toThrow('RESEARCH_SEARCH_UNAVAILABLE');
 });
});
/**
 * issue #3204 ② —— 失败原因必须可分辨。
 *
 * 人类实测 `fetch_url https://openai.com/index/navier-stokes-solution/` 只拿到一句
 * 「Web source unavailable or refused; no content confirmed.」。本 PR 落地前的实测取证
 * （curl 直连，默认 UA 与浏览器 UA 各一次，两次同样）：
 *
 *   HTTP/2 403
 *   cf-mitigated: challenge
 *   server: cloudflare
 *   critical-ch: Sec-CH-UA-...
 *
 * 也就是 **(b) 上游真拒绝**（Cloudflare 机器人挑战），不是 SSRF 策略、不是超时。产品行为
 * 正确，缺的是"说清是哪一种"：三种成因此前被压平三次（取回层丢状态码、控制器 `catch{}`、
 * Python 侧任意 503 同一句话），于是 (a)/(b)/(c) 在产品里完全不可分辨。
 *
 * 这一组就是那道闸——同一个 URL 的不同失败必须给出**不同**的成因。
 */
describe('issue #3204 ② fetch_url 的失败原因可分辨',()=>{
 const service=(fetcher:typeof fetch)=>new DefaultStandardWebService(emptySearch,fetcher);
 async function reasonOf(run:()=>Promise<unknown>){
  try{await run();return {reason:'__no_failure__' as string,upstreamStatus:undefined as number|undefined};}
  catch(error){const failure=classifyStandardWebFailure(error);return {reason:failure.reason as string,upstreamStatus:failure.upstreamStatus};}
 }
 it('(b) 上游拒绝：带上真实状态码，不与其它成因同名',async()=>{
  // 复刻 openai.com 实测形状：403 + Cloudflare 挑战页正文（HTML，MIME 本身是"支持"的）。
  const url=await fixture((req,res)=>{res.writeHead(403,{'content-type':'text/html; charset=UTF-8','cf-mitigated':'challenge','server':'cloudflare'});res.end('<html><body>Just a moment...</body></html>');});
  const failure=await reasonOf(()=>service(localFetch()).fetch({url}));
  expect(failure.reason).toBe('upstream_refused');
  expect(failure.upstreamStatus).toBe(403);
 });
 it('(a) 被我们自己的出站策略挡下：说成 blocked_by_policy，不许说成"网站拒绝了你"',async()=>{
  const failure=await reasonOf(()=>service(createStandardWebFetch()).fetch({url:'https://169.254.169.254/latest'}));
  expect(failure.reason).toBe('blocked_by_policy');
  expect(failure.upstreamStatus).toBeUndefined();
 });
 it('(c) 超时：说成 timeout，不许说成"被拒"',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.write('a');const timer=setInterval(()=>res.write('b'),10);res.on('close',()=>clearInterval(timer));});
  const failure=await reasonOf(()=>service(localFetch(100)).fetch({url}));
  expect(failure.reason).toBe('timeout');
 });
 it('响应到了但抽不出正文（挑战页/纯脚本页）自成一类，不冒充"网站拒绝"',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<html><body><script>document.write("x")</script></body></html>');});
  const failure=await reasonOf(()=>service(localFetch()).fetch({url}));
  expect(failure.reason).toBe('no_content');
 });
 it('四种成因两两不同——这条才是"可分辨"本身（修复前四条全是同一句话）',async()=>{
  const refused=await fixture((req,res)=>{res.writeHead(403,{'content-type':'text/html'});res.end('<html><body>Just a moment...</body></html>');});
  const empty=await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<html><body><script>x</script></body></html>');});
  const reasons=[
   (await reasonOf(()=>service(localFetch()).fetch({url:refused}))).reason,
   (await reasonOf(()=>service(createStandardWebFetch()).fetch({url:'https://169.254.169.254/latest'}))).reason,
   (await reasonOf(()=>service(localFetch()).fetch({url:empty}))).reason,
  ];
  expect(new Set(reasons).size).toBe(reasons.length);
  expect(reasons).not.toContain('unknown');
 });
 it('成因里不夹带上游正文与响应头——可分辨不等于把上游内容透出去',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(403,{'content-type':'text/html','x-secret-header':'upstream-sensitive-header'});res.end('<html><body>upstream-sensitive-content</body></html>');});
  let text='';
  try{await service(localFetch()).fetch({url});}catch(error){const f=classifyStandardWebFailure(error);text=JSON.stringify({reason:f.reason,upstreamStatus:f.upstreamStatus,message:f.message});}
  expect(text).not.toContain('upstream-sensitive-content');
  expect(text).not.toContain('upstream-sensitive-header');
 });
});
