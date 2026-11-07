import {expect,it,vi} from 'vitest';
import {runQwenImageActivation} from '../../scripts/activate-qwen-image';
import {imageFixedCnyPrice} from '../../src/domain/agent-run/image-activation-pricing';
import {activationBaseUrl,activationApiUrl} from '../../scripts/qwen-image-activation-url';
const quote={version:'catalog-cn-live-test',market:'cn',enabledProviders:[],products:[{kind:'credit_topup',sku:'cn-min',currency:'CNY',amountMinor:12900,credits:10000}]};
const env={QWEN_ACTIVATION_QUOTE_ORG_ID:'target & org',QWEN_ACTIVATION_REGION:'cn-beijing',QWEN_ACTIVATION_TOKEN_FILE:'/protected/token',QWEN_ACTIVATION_COOKIE_FILE:'/protected/cookie'};
const schedule={scope:'global',revision:'revision-one',items:([['qwen-image-3.0','50'],['qwen-image-3.0-pro','100'],['z-image-turbo','25']] as const).map(([modelId,customerAmountMinor])=>({modelProvider:'bailian-image',modelId,unit:'image',customerAmountMinor,currency:'CNY',quantum:'1',hundredthsPerQuantum:imageFixedCnyPrice(BigInt(customerAmountMinor)*10000n,quote).hundredthsPerImage,version:'fixed-test',catalogVersion:quote.version}))};
function setup(change=false,alreadyActive=false){
 const calls:{url:string;options:RequestInit}[]=[],logs:string[]=[];let bases=0,active=alreadyActive;
 const fetcher=vi.fn(async(url:unknown,options?:RequestInit)=>{
  calls.push({url:String(url),options:options!});
  if(String(url).includes('image-pricing-basis')){bases++;return Response.json(change&&bases>1?{...quote,version:'changed-live'}:quote);}
  if(options?.method==='PUT'){active=true;return Response.json(schedule);}
  return Response.json(active?schedule:{scope:'global',revision:null,items:[]});
 });
 const run=(args:string[])=>runQwenImageActivation({env,args,fetcher:fetcher as typeof fetch,readFile:path=>path.endsWith('token')?'test-session-token':'test-proxy-cookie',log:message=>logs.push(message)});
 return {run,calls,logs,fetcher};
}
it('dryrun sends the actual /api admin route, encoded org query, trusted Bearer and optional proxy Cookie, without writes or secret output',async()=>{
 const f=setup();await f.run(['--fixed-prices']);expect(f.calls).toHaveLength(1);
 expect(f.calls[0]!.url).toBe('https://devapp.boardx.us/api/platform/billing/consumption/image-pricing-basis?orgId=target%20%26%20org');
 expect(f.calls[0]!.options).toMatchObject({method:'GET',redirect:'error',headers:{authorization:'Bearer test-session-token',cookie:'test-proxy-cookie'}});expect(f.calls[0]!.options.body).toBeUndefined();
 const output=f.logs.join('');expect(output).toContain('dryrun');expect(output).toContain('catalog-cn-live-test');expect(output).toContain('cn-min');expect(output).not.toContain('test-session-token');expect(output).not.toContain('test-proxy-cookie');
});
it('apply rechecks the live quote and performs one global CAS followed by independent readback',async()=>{
 const f=setup();await f.run(['--fixed-prices','--apply']);expect(f.calls.map(call=>call.options.method)).toEqual(['GET','GET','GET','PUT','GET']);
 const put=f.calls.find(call=>call.options.method==='PUT')!;
 expect(put.url).toBe('https://devapp.boardx.us/api/platform/billing/consumption/global-native-tariffs');
 expect(JSON.parse(String(put.options.body))).toEqual({expectedRevision:null,expectedCatalogVersion:quote.version});
 expect(f.calls.slice(2).every(call=>!call.url.includes('?'))).toBe(true);
});
it('matching global schedule is idempotent and does not append a second activation audit',async()=>{const f=setup(false,true);await f.run(['--fixed-prices','--apply']);expect(f.calls.every(call=>call.options.method==='GET')).toBe(true);expect(f.logs.join('')).toContain('"unchanged":true');});
it('list reads the global CAS schedule without organization context',async()=>{const f=setup();await f.run([]);expect(f.calls).toHaveLength(1);expect(f.calls[0]!.url).toBe('https://devapp.boardx.us/api/platform/billing/consumption/global-native-tariffs');});
it('explicitly rejects legacy org scope before any request',async()=>{
 const fetcher=vi.fn();await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_ORG_ID:'old-org'},args:[],fetcher})).rejects.toThrow('LEGACY_ORG_SCOPE_REJECTED_USE_GLOBAL_SCHEDULE');
 for(const args of [['--org-id=old-org'],['--orgid=old'],['--orgid','old'],['--orgId=old','--fixed-prices','--apply'],['--ORGID','old'],['--org','old']])await expect(runQwenImageActivation({env,args,fetcher})).rejects.toThrow('LEGACY_ORG_SCOPE_REJECTED_USE_GLOBAL_SCHEDULE');expect(fetcher).not.toHaveBeenCalled();
});
it('CAS conflict is surfaced without retry or fallback org writes',async()=>{
 const f=setup();f.fetcher.mockImplementationOnce(async()=>Response.json(quote)).mockImplementationOnce(async()=>Response.json(quote)).mockImplementationOnce(async()=>Response.json({scope:'global',revision:null,items:[]})).mockImplementationOnce(async()=>Response.json({message:'conflict'},{status:409}));
 await expect(f.run(['--fixed-prices','--apply'])).rejects.toThrow('ACTIVATION_HTTP_409');expect(f.fetcher).toHaveBeenCalledTimes(4);
});
it('rejects a saved schedule inconsistent with the fixed quote',async()=>{
 const f=setup();f.fetcher.mockImplementationOnce(async()=>Response.json(quote)).mockImplementationOnce(async()=>Response.json(quote)).mockImplementationOnce(async()=>Response.json({scope:'global',revision:null,items:[]})).mockImplementationOnce(async()=>Response.json({...schedule,items:schedule.items.map(row=>({...row,hundredthsPerQuantum:'1'}))}));
 await expect(f.run(['--fixed-prices','--apply'])).rejects.toThrow('TARIFF_READBACK_MISMATCH');
});
it('rejects independent readback drift after successful CAS without retry',async()=>{
 const f=setup();f.fetcher.mockImplementationOnce(async()=>Response.json(quote)).mockImplementationOnce(async()=>Response.json(quote)).mockImplementationOnce(async()=>Response.json({scope:'global',revision:null,items:[]})).mockImplementationOnce(async()=>Response.json(schedule)).mockImplementationOnce(async()=>Response.json({...schedule,revision:'concurrent-revision'}));
 await expect(f.run(['--fixed-prices','--apply'])).rejects.toThrow('TARIFF_READBACK_MISMATCH');expect(f.fetcher).toHaveBeenCalledTimes(5);
});
it('does not write if the live quote/version changes',async()=>{const f=setup(true);await expect(f.run(['--fixed-prices','--apply'])).rejects.toThrow('CREDIT_QUOTE_CHANGED');expect(f.calls.every(call=>call.options.method==='GET')).toBe(true);});
it('Cookie alone is not API session authentication',async()=>{
 const fetcher=vi.fn();await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_TOKEN_FILE:undefined},args:['--fixed-prices'],fetcher,readFile:()=> 'proxy-cookie',log:()=>{}})).rejects.toThrow('DEVAPP_OPERATOR_TOKEN_REQUIRED');expect(fetcher).not.toHaveBeenCalled();
});
it('keeps safe missing-CNY diagnostics and redacts unknown HTTP response data',async()=>{
 for(const [message,expected]of [['image_cny_quote_unconfigured','IMAGE_CNY_QUOTE_UNCONFIGURED'],['upstream-sensitive-data','ACTIVATION_HTTP_503']]){
  await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_TOKEN_FILE:undefined,QWEN_ACTIVATION_TOKEN:'test-only'},args:['--fixed-prices'],readFile:()=>'',fetcher:vi.fn(async()=>Response.json({message},{status:503})) as typeof fetch,log:()=>{}})).rejects.toThrow(expected!);
 }
});
it('preserves only supported API prefixes and rejects foreign/credentialed bases',()=>{
 expect(String(activationApiUrl(activationBaseUrl('https://devapp.boardx.us/api/'),'/platform/billing/consumption/native-tariffs'))).toContain('/api/platform/');
 for(const raw of ['https://evil.test/api','http://devapp.boardx.us/api','https://secret@devapp.boardx.us/api','https://devapp.boardx.us/arbitrary','https://devapp.boardx.us'])expect(()=>activationBaseUrl(raw)).toThrow();
});

it('offline snapshot preview cannot activate without an operator Bearer token',async()=>{
 const fetcher=vi.fn();await expect(runQwenImageActivation({env:{...env,QWEN_ACTIVATION_TOKEN_FILE:undefined,QWEN_ACTIVATION_CATALOG_SNAPSHOT:'/snapshot'},args:['--fixed-prices','--apply'],fetcher,readFile:path=>path==='/snapshot'?JSON.stringify(quote):'proxy-cookie',log:()=>{}})).rejects.toThrow('DEVAPP_OPERATOR_TOKEN_REQUIRED');expect(fetcher).not.toHaveBeenCalled();
});

it('rejects the obsolete markup switch before requests',async()=>{await expect(runQwenImageActivation({args:['--markup10'],env:{}})).rejects.toThrow('LEGACY_MARKUP_DISABLED_USE_FIXED_PRICES');});

it('unknown arguments fail before HTTP instead of silently changing global scope',async()=>{const fetcher=vi.fn();for(const args of [['--scope=org','--fixed-prices','--apply'],['old-org'],['--dry-run']])await expect(runQwenImageActivation({env,args,fetcher})).rejects.toThrow('UNKNOWN_ACTIVATION_ARGUMENT');expect(fetcher).not.toHaveBeenCalled();});

it('supports only the explicit CN production API origin and retains authenticated global CAS', async()=>{
 const f=setup();
 await runQwenImageActivation({env:{...env,QWEN_ACTIVATION_BASE_URL:'https://app.workspacex.cn/api'},args:['--fixed-prices','--apply'],fetcher:f.fetcher as typeof fetch,readFile:()=> 'test-session-token',log:()=>{}});
 expect(f.calls.map(c=>c.options.method)).toEqual(['GET','GET','GET','PUT','GET']);
 expect(f.calls.every(c=>new URL(c.url).origin==='https://app.workspacex.cn')).toBe(true);
 expect(f.calls.every(c=>c.options.redirect==='error')).toBe(true);
 for(const raw of ['http://app.workspacex.cn/api','https://app.workspacex.cn.evil.test/api','https://app.workspacex.cn/api?token=x','https://app.workspacex.cn:8443/api','https://app.workspacex.cn/','https://secret@app.workspacex.cn/api']) expect(()=>activationBaseUrl(raw)).toThrow();
});
