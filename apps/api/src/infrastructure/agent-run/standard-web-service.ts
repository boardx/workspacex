import {createHash} from 'node:crypto';
import {WebSearchInput,WebSearchOutput,FetchUrlInput,FetchUrlOutput,STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
import type {StandardWebService} from '../../application/agent-run/standard-web-tools';
import type {GuidedSearchPort} from '../../application/research/guided-runtime-ports';
import {assertMcpEndpointAllowed} from '../../domain/mcp/remote-endpoint-guard';
import {GoogleGuidedSearch} from '../research/google-guided-search';
import {createStandardWebFetch} from './standard-web-fetch';
import {extractStandardWebHtml} from './standard-web-extractor';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const normalized=(raw:string)=>{const url=assertMcpEndpointAllowed(raw,{localOnlyOrg:false});url.hash='';return url.href;};
/** Adapt existing search, do not imply provider-side filters or full-page snippets. */
export class DefaultStandardWebService implements StandardWebService {
 constructor(private searcher:GuidedSearchPort,private fetcher:typeof fetch,
 private extract:typeof extractStandardWebHtml=extractStandardWebHtml){}
 async search(raw:Parameters<StandardWebService['search']>[0]){
  const input=WebSearchInput.parse(raw),hits=await this.searcher.search(input.query),at=new Date().toISOString();
  const eligible=hits.map(hit=>({...hit,url:normalized(hit.url)})).filter(hit=>!input.domains?.length||input.domains.some(domain=>new URL(hit.url).hostname===domain||new URL(hit.url).hostname.endsWith('.'+domain)));
  const selected=eligible.slice(0,input.limit??L.maxResults);
  return WebSearchOutput.parse({results:selected.map(hit=>({sourceId:'web:'+hash(hit.url),url:hit.url,title:hit.title.slice(0,1000),snippet:hit.content.slice(0,L.maxSnippetChars),contentHash:hash(hit.content.slice(0,L.maxSnippetChars)),retrievedAt:at})),truncated:hits.length>=L.maxResults||eligible.length>selected.length||selected.some(hit=>hit.content.length>L.maxSnippetChars),provider:'boardx-google',candidateLimit:L.maxResults,domainFilter:'post-filter-provider-candidates',contentKind:'search-snippet'});
 }
 async fetch(raw:Parameters<StandardWebService['fetch']>[0]){
  const {url:rawUrl}=FetchUrlInput.parse(raw),url=normalized(rawUrl),response=await this.fetcher(url);
  const contentType=response.headers.get('content-type')?.toLowerCase()??'';
  const mime=contentType.split(';')[0]?.trim();
  if(!['text/html','text/plain','text/markdown'].includes(mime??'')||(/charset\s*=/.test(contentType)&&! /charset\s*=\s*["']?utf-8\b/.test(contentType)))throw new Error('standard_web_unsupported_type');
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(await response.arrayBuffer());
  const article=mime==='text/html'?await this.extract(decoded,url):{title:url,text:decoded};
  if(!article.text.trim())throw new Error('standard_web_no_content');
  return FetchUrlOutput.parse({sourceId:'web:'+hash(url),url,resolvedUrl:url,title:article.title.slice(0,1000),text:article.text.slice(0,L.maxTextChars),contentHash:hash(article.text),retrievedAt:new Date().toISOString(),truncated:article.text.length>L.maxTextChars,contentKind:'extracted-text',extractor:mime==='text/html'?'mozilla-readability':'utf8-text',hashScope:'full-extracted-text'});
 }
}
export function createStandardWebService():StandardWebService {
 const fetcher=createStandardWebFetch();
 return new DefaultStandardWebService(new GoogleGuidedSearch(fetcher),fetcher);
}
