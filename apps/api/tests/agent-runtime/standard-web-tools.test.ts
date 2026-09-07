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
  await expect(localFetch()(url)).rejects.toThrow('body_limit');
 });
 it('wall clock deadline stops a trickling body',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.write('a');const timer=setInterval(()=>res.write('b'),10);res.on('close',()=>clearInterval(timer));});
  const start=Date.now();await expect(localFetch(100)(url)).rejects.toThrow();expect(Date.now()-start).toBeLessThan(1500);
 });
 it('encoding and unsupported MIME are not invented plaintext',async()=>{
  const url=await fixture((req,res)=>{res.writeHead(200,{'content-type':'application/pdf'});res.end('not a web page');});
  const service=new DefaultStandardWebService(emptySearch,localFetch());await expect(service.fetch({url})).rejects.toThrow('unsupported_type');
 });
 it('real Readability worker extracts article without executing scripts or loading subresources',async()=>{
  let requests=0;const paragraph='This is an evidence-backed article with enough substantive content to identify the main article. '.repeat(12);
  const url=await fixture((req,res)=>{requests++;res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(`<html><head><title>真实来源</title></head><body><article><h1>真实来源</h1><p>${paragraph}</p><script>throw new Error('must not run');fetch('/secret')</script><img src='/tracking'/></article></body></html>`);});
  const output=await new DefaultStandardWebService(emptySearch,localFetch()).fetch({url});
  expect(output.title).toBe('真实来源');expect(output.text).toContain(paragraph);expect(output.text).not.toContain('must not run');expect(requests).toBe(1);
  expect(output.contentHash).toBe(createHash('sha256').update(output.text).digest('hex'));expect(output.extractor).toBe('mozilla-readability');
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
