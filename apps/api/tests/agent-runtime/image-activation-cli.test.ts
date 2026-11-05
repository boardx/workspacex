import {expect,it,vi} from 'vitest';
import {runQwenImageActivation} from '../../scripts/activate-qwen-image';
import {activationBaseUrl,activationApiUrl} from '../../scripts/qwen-image-activation-url';
const quote={version:'catalog-cn-live-test',market:'cn',enabledProviders:[],products:[{kind:'credit_topup',sku:'cn-min',currency:'CNY',amountMinor:12900,credits:10000}]};
const env={QWEN_ACTIVATION_REGION:'cn-beijing',QWEN_ACTIVATION_TOKEN_FILE:'/protected/token',QWEN_ACTIVATION_COOKIE_FILE:'/protected/cookie'};
function setup(change=false){
 const calls:{url:string;options:RequestInit}[]=[],logs:string[]=[];let bases=0;
 const fetcher=vi.fn(async(url:unknown,options?:RequestInit)=>{
  calls.push({url:String(url),options:options!});
  if(String(url).includes('image-pricing-basis')){bases++;return Response.json(change&&bases>1?{...quote,version:'changed-live'}:quote);}
  if(options?.method==='PUT')return Response.json(JSON.parse(String(options.body)));
  return Response.json({items:[]});
 });
 const run=(args:string[])=>runQwenImageActivation({env,args,fetcher:fetcher as typeof fetch,readFile:path=>path.endsWith('token')?'test-session-token':'test-proxy-cookie',log:message=>logs.push(message)});
 return {run,calls,logs,fetcher};
}
it('dryrun sends the actual /api admin route, global query, trusted Bearer and optional proxy Cookie, without writes or secret output',async()=>{
 const f=setup();await f.run(['--markup10']);expect(f.calls).toHaveLength(1);
 expect(f.calls[0]!.url).toBe('https://devapp.boardx.us/api/platform/billing/consumption/image-pricing-basis');
 expect(f.calls[0]!.options).toMatchObject({method:'GET',redirect:'error',headers:{authorization:'Bearer test-session-token',cookie:'test-proxy-cookie'}});expect(f.calls[0]!.options.body).toBeUndefined();
 const output=f.logs.join('');expect(output).toContain('dryrun');expect(output).toContain('catalog-cn-live-test');expect(output).toContain('cn-min');expect(output).not.toContain('test-session-token');expect(output).not.toContain('test-proxy-cookie');
});
it('apply rechecks the exact live quote, lists deployment prices and sends exactly three contract tariff PUT bodies',async()=>{
 const f=setup();await f.run(['--markup10','--apply']);expect(f.calls.map(call=>call.options.method)).toEqual(['GET','GET','GET','PUT','PUT','PUT']);
 const puts=f.calls.filter(call=>call.options.method==='PUT');expect(puts.map(call=>JSON.parse(String(call.options.body)).modelId)).toEqual(['qwen-image-3.0','qwen-image-3.0-pro','z-image-turbo']);
 for(const call of puts){expect(call.url).toBe('https://devapp.boardx.us/api/platform/billing/consumption/native-tariffs');expect(JSON.parse(String(call.options.body))).toMatchObject({modelProvider:'bailian-image',unit:'image',quantum:'1'});}
});
it('does not write if the live quote/version changes',async()=>{const f=setup(true);await expect(f.run(['--markup10','--apply'])).rejects.toThrow('CREDIT_QUOTE_CHANGED');expect(f.calls.every(call=>call.options.method==='GET')).toBe(true);});
it('Cookie alone is not API session authentication',async()=>{
 const fetcher=vi.fn();await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_TOKEN_FILE:undefined},args:['--markup10'],fetcher,readFile:()=> 'proxy-cookie',log:()=>{}})).rejects.toThrow('DEVAPP_OPERATOR_TOKEN_REQUIRED');expect(fetcher).not.toHaveBeenCalled();
});
it('keeps safe missing-CNY diagnostics and redacts unknown HTTP response data',async()=>{
 for(const [message,expected]of [['image_cny_quote_unconfigured','IMAGE_CNY_QUOTE_UNCONFIGURED'],['upstream-sensitive-data','ACTIVATION_HTTP_503']]){
  await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_TOKEN_FILE:undefined,QWEN_ACTIVATION_TOKEN:'test-only'},args:['--markup10'],readFile:()=>'',fetcher:vi.fn(async()=>Response.json({message},{status:503})) as typeof fetch,log:()=>{}})).rejects.toThrow(expected!);
 }
});
it('preserves only supported API prefixes and rejects foreign/credentialed bases',()=>{
 expect(String(activationApiUrl(activationBaseUrl('https://devapp.boardx.us/api/'),'/platform/billing/consumption/native-tariffs'))).toContain('/api/platform/');
 for(const raw of ['https://evil.test/api','http://devapp.boardx.us/api','https://secret@devapp.boardx.us/api','https://devapp.boardx.us/arbitrary','https://devapp.boardx.us'])expect(()=>activationBaseUrl(raw)).toThrow();
});

it('offline snapshot preview cannot activate without an operator Bearer token',async()=>{
 const fetcher=vi.fn();await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_TOKEN_FILE:undefined,QWEN_ACTIVATION_CATALOG_SNAPSHOT:'/snapshot'},args:['--markup10','--apply'],fetcher,readFile:path=>path==='/snapshot'?JSON.stringify(quote):'proxy-cookie',log:()=>{}})).rejects.toThrow('DEVAPP_OPERATOR_TOKEN_REQUIRED');expect(fetcher).not.toHaveBeenCalled();
});

it('explicitly rejects legacy org-scoped activation input before any network call',async()=>{
 const fetcher=vi.fn();await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_ORG_ID:'legacy-org'},args:['--markup10'],fetcher,readFile:()=> 'test-only',log:()=>{}})).rejects.toThrow('LEGACY_ORG_SCOPED_ACTIVATION_REMOVED');expect(fetcher).not.toHaveBeenCalled();
});
