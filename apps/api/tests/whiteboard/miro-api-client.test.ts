import { describe, expect, it, vi } from 'vitest';
import { MiroApiClient } from '../../src/infrastructure/whiteboard/miro-api-client';
import { MiroImportError } from '../../src/application/whiteboard/miro-ports';

const config={clientId:'client',clientSecret:'secret',redirectUri:'https://app.workspacex.test/studio/board/miro/callback'};
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
  it('exchanges and refreshes credentials against the fixed token endpoint with parsed rotation data',async()=>{
    const http=vi.fn(async(_url:URL,_init?:RequestInit)=>json({
      access_token:'next-access',
      refresh_token:'next-refresh',
      expires_in:3_600,
      scope:'boards:read',
    }));
    const client=new MiroApiClient(config,http as typeof fetch);

    await expect(client.exchange('one-time-code')).resolves.toMatchObject({
      credential:{access:'next-access',refresh:'next-refresh'},
      scopes:['boards:read'],
    });
    await expect(client.refresh('old-refresh')).resolves.toMatchObject({
      credential:{access:'next-access',refresh:'next-refresh'},
      scopes:['boards:read'],
    });

    expect(http).toHaveBeenCalledTimes(2);
    const [exchangeUrl,exchangeInit]=http.mock.calls[0] as unknown as [URL,RequestInit];
    expect(exchangeUrl.toString()).toBe('https://api.miro.com/v1/oauth/token');
    expect(exchangeInit).toMatchObject({method:'POST',redirect:'error'});
    expect(String(exchangeInit.body)).toContain('grant_type=authorization_code');
    expect(String(exchangeInit.body)).toContain('code=one-time-code');
    expect(String(exchangeInit.body)).toContain(`redirect_uri=${encodeURIComponent(config.redirectUri)}`);
    const [refreshUrl,refreshInit]=http.mock.calls[1] as unknown as [URL,RequestInit];
    expect(refreshUrl.toString()).toBe('https://api.miro.com/v1/oauth/token');
    expect(String(refreshInit.body)).toContain('grant_type=refresh_token');
    expect(String(refreshInit.body)).toContain('refresh_token=old-refresh');
  });
  it('maps a token response without the required scope without exposing credentials or remote content',async()=>{
    const http=vi.fn(async()=>json({access_token:'sensitive-access',refresh_token:'sensitive-refresh'}));
    const client=new MiroApiClient(config,http as typeof fetch);
    const failure=await client.exchange('sensitive-code').catch(error=>error as Error & {code?:string});
    expect(failure).toMatchObject({code:'OAUTH_SCOPE_INSUFFICIENT'});
    expect(JSON.stringify(failure)).not.toMatch(/sensitive-(?:access|refresh|code)|secret/);
  });
  it.each([
    'http://app.workspacex.test/studio/board/miro/callback',
    'https://app.workspacex.test/whiteboards/miro/oauth/callback',
    'https://app.workspacex.test/studio/board/miro/callback?next=https://evil.test',
  ])('rejects a redirect URI that is not the fixed HTTPS Web callback: %s',(redirectUri)=>{
    expect(()=>new MiroApiClient({...config,redirectUri})).toThrow('MIRO_OAUTH_CONFIG_INVALID');
  });
});
