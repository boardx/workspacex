import { describe, expect, it, vi } from 'vitest';
import { MiroApiClient } from '../../src/infrastructure/whiteboard/miro-api-client';
import { MiroImportError } from '../../src/application/whiteboard/miro-ports';

const config={clientId:'client',clientSecret:'secret',redirectUri:'https://api.workspacex.test/whiteboards/miro/oauth/callback'};
const json=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});

describe('Miro official HTTP client',()=>{
  it.each([
    ['delta seconds','2',2_000],
    ['HTTP date','Thu, 01 Jan 2026 00:00:03 GMT',3_000],
  ])('bounds Retry-After %s and cancels every retry body',async(_label,retryAfter,expected)=>{
    const bodies:ReadableStream[]=[]; let calls=0; const sleep=vi.fn(async()=>{});
    const http=vi.fn(async(_url:URL,_init?:RequestInit)=>{
      calls++; if(calls<3){const response=json({ignored:true},429,{'retry-after':retryAfter});bodies.push(response.body!);return response;}
      return json({data:[],total:0});
    });
    const client=new MiroApiClient(config,http as typeof fetch,sleep,1_000,()=>Date.parse('2026-01-01T00:00:00Z'));
    await expect(client.boards('access',0,50)).resolves.toMatchObject({items:[],hasMore:false});
    expect(sleep).toHaveBeenNthCalledWith(1,expected); expect(sleep).toHaveBeenNthCalledWith(2,expected);
    for(const body of bodies)expect(body.locked).toBe(false);
    for(const call of http.mock.calls){expect((call[0] as URL).origin).toBe('https://api.miro.com');expect(call[1]).toMatchObject({redirect:'error'});}
  });
  it('never follows redirects and rejects oversized or drifting payloads',async()=>{
    const redirecting=vi.fn(async(_url:URL,init?:RequestInit)=>{expect(init?.redirect).toBe('error');throw new TypeError('redirect blocked');});
    await expect(new MiroApiClient(config,redirecting as typeof fetch).boards('a',0,1)).rejects.toMatchObject({code:'REMOTE_UNAVAILABLE'});
    const oversized=vi.fn(async(_url:URL,_init?:RequestInit)=>json({},200,{'content-length':String(16*1024*1024+1)}));
    await expect(new MiroApiClient(config,oversized as typeof fetch).boards('a',0,1)).rejects.toMatchObject({code:'PAYLOAD_TOO_LARGE'});
    const drift=vi.fn(async(_url:URL,_init?:RequestInit)=>json({boards:[]}));
    await expect(new MiroApiClient(config,drift as typeof fetch).boards('a',0,1)).rejects.toBeInstanceOf(MiroImportError);
  });
  it('requests only boards:read and never puts a secret in the authorization URL',()=>{
    const url=new URL(new MiroApiClient(config).authorizationUrl('state-value'));
    expect(url.origin).toBe('https://miro.com'); expect(url.searchParams.get('scope')).toBe('boards:read');
    expect(url.toString()).not.toContain(config.clientSecret);
  });
});
