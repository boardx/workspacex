import {createHash} from 'node:crypto';
import {WebSearchInput,WebSearchOutput,FetchUrlInput,FetchUrlOutput,STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
import type {StandardWebService} from '../../application/agent-run/standard-web-tools';
import type {GuidedSearchPort} from '../../application/research/guided-runtime-ports';
import {assertMcpEndpointAllowed} from '../../domain/mcp/remote-endpoint-guard';
import {GoogleGuidedSearch} from '../research/google-guided-search';
import {createStandardWebFetch} from './standard-web-fetch';
import {extractStandardWebHtml} from './standard-web-extractor';
import {StandardWebFailure} from '../../domain/agent-run/standard-web-failure';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const normalized=(raw:string)=>{const url=assertMcpEndpointAllowed(raw,{localOnlyOrg:false});url.hash='';return url.href;};
/** Adapt existing search, do not imply provider-side filters or full-page snippets. */
export class DefaultStandardWebService implements StandardWebService {
 constructor(private searcher:GuidedSearchPort,private fetcher:typeof fetch,
 private extract:typeof extractStandardWebHtml=extractStandardWebHtml){}
 async search(raw:Parameters<StandardWebService['search']>[0]){
  const input=WebSearchInput.parse(raw),hits=await this.searcher.search(input.query),at=new Date().toISOString();
  /*
   * issue #3388 —— 一个**候选**不合出站策略，不构成"这次搜索失败"。
   *
   * 此前这里是 `hits.map(hit=>({...hit,url:normalized(hit.url)}))`：`normalized` 对
   * `http://` 候选抛 `McpEndpointRefusedError`，异常穿过整个 `search()`，控制器收成 503，
   * 模型收到的是「Web source unavailable or refused」——**整次搜索**没了，尽管另外四条
   * 候选完全可用。实测（2026-09-11，真实上游 www.web-search.boardx.us，SHA a1337fcb4）：
   * 人类那条「2026年新能源汽车销量最新数据」12/12 全失败，肇事者恒为
   * `http://www.caam.org.cn/tjsj`（中汽协官网只有 http）——这个话题下它必进前五。
   * 8 条同类查询混跑 14/40 = 35% 失败，全部同一个 `MCP_ENDPOINT_SCHEME_FORBIDDEN`。
   *
   * 出站策略本身不放宽：这些候选照旧不可取回（`fetch_url` 会如实拒绝它们）。变的只是
   * **爆炸半径**——把不可用的候选丢掉，而不是把可用的一起炸掉。丢弃过要让模型知道，
   * 所以计入 `truncated`：候选集被裁过 ≠ 网上没有别的来源。
   */
  const admitted:{title:string;url:string;content:string}[]=[];let refusedCandidates=0;
  for(const hit of hits){
   let url:string;
   try{url=normalized(hit.url);}catch{refusedCandidates++;continue;}
   admitted.push({...hit,url});
  }
  const eligible=admitted.filter(hit=>!input.domains?.length||input.domains.some(domain=>new URL(hit.url).hostname===domain||new URL(hit.url).hostname.endsWith('.'+domain)));
  const selected=eligible.slice(0,input.limit??L.maxResults);
  return WebSearchOutput.parse({results:selected.map(hit=>({sourceId:'web:'+hash(hit.url),url:hit.url,title:hit.title.slice(0,1000),snippet:hit.content.slice(0,L.maxSnippetChars),contentHash:hash(hit.content.slice(0,L.maxSnippetChars)),retrievedAt:at})),truncated:hits.length>=L.maxResults||refusedCandidates>0||eligible.length>selected.length||selected.some(hit=>hit.content.length>L.maxSnippetChars),provider:'boardx-google',candidateLimit:L.maxResults,domainFilter:'post-filter-provider-candidates',contentKind:'search-snippet'});
 }
 async fetch(raw:Parameters<StandardWebService['fetch']>[0]){
  const {url:rawUrl}=FetchUrlInput.parse(raw);
  let url:string;
  try{url=normalized(rawUrl);}catch{throw new StandardWebFailure('blocked_by_policy');}
  const response=await this.fetcher(url);
  const contentType=response.headers.get('content-type')?.toLowerCase()??'';
  const mime=contentType.split(';')[0]?.trim();
  if(!['text/html','text/plain','text/markdown'].includes(mime??'')||(/charset\s*=/.test(contentType)&&! /charset\s*=\s*["']?utf-8\b/.test(contentType)))throw new StandardWebFailure('unsupported_content');
  let decoded:string;
  try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(await response.arrayBuffer());}
  catch{throw new StandardWebFailure('unsupported_content');}
  // Readability 抽不出正文（`standard_web_extract_failed`）= 页面响应了但没有可读正文，
  // 与"网站拒绝"是两回事。解析器忙/解析超时是**我们这边**的容量问题，不冒充对页面的判断，
  // 交给分类器落到 `unknown`（issue #3204 ②）。
  let article:{title:string;text:string};
  try{article=mime==='text/html'?await this.extract(decoded,url):{title:url,text:decoded};}
  catch(error){
   if(error instanceof Error&&error.message==='standard_web_extract_failed')throw new StandardWebFailure('no_content');
   throw error;
  }
  // 「响应到了但抽不出正文」——挑战页/纯脚本页就长这样。它不是"网站拒绝"，
  // 也不是"不可达"，得有自己的名字（issue #3204 ②）。
  if(!article.text.trim())throw new StandardWebFailure('no_content');
  return FetchUrlOutput.parse({sourceId:'web:'+hash(url),url,resolvedUrl:url,title:article.title.slice(0,1000),text:article.text.slice(0,L.maxTextChars),contentHash:hash(article.text),retrievedAt:new Date().toISOString(),truncated:article.text.length>L.maxTextChars,contentKind:'extracted-text',extractor:mime==='text/html'?'mozilla-readability':'utf8-text',hashScope:'full-extracted-text'});
 }
}
export function createStandardWebService():StandardWebService {
 const fetcher=createStandardWebFetch();
 return new DefaultStandardWebService(new GoogleGuidedSearch(fetcher),fetcher);
}
