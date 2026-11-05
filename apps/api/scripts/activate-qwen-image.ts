/** Existing operator-only tariff API; default read-only. No SQL or supplier dispatch. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {activationBaseUrl,activationApiUrl} from './qwen-image-activation-url';
import {GlobalImageTariffSchedule,globalImageTariffOperations,nativeTariffOperations} from '../../../packages/contracts/src/billing-consumption';
import {imageFixedCnyPrice} from '../src/domain/agent-run/image-activation-pricing';
const models=['qwen-image-3.0','qwen-image-3.0-pro','z-image-turbo'];
export async function runQwenImageActivation(options:{env?:NodeJS.ProcessEnv;args?:readonly string[];fetcher?:typeof fetch;readFile?:(path:string)=>string;log?:(message:string)=>void}={}){
 const env=options.env??process.env,args=options.args??process.argv.slice(2),fetcher=options.fetcher??fetch,read=options.readFile??((path:string)=>readFileSync(path,'utf8')),log=options.log??console.log;
 const base=activationBaseUrl(env.QWEN_ACTIVATION_BASE_URL);
 if(env.QWEN_ACTIVATION_ORG_ID||args.some(arg=>/^--org(?:-?id)?(?:=|$)/i.test(arg)))throw new Error('LEGACY_ORG_SCOPE_REJECTED_USE_GLOBAL_SCHEDULE');
 // Required only by the read-only CN catalog endpoint, never a tariff selector.
 const quoteOrgId=env.QWEN_ACTIVATION_QUOTE_ORG_ID;
 const cookie=env.QWEN_ACTIVATION_COOKIE_FILE?read(env.QWEN_ACTIVATION_COOKIE_FILE).trim():env.QWEN_ACTIVATION_COOKIE;
 const token=env.QWEN_ACTIVATION_TOKEN_FILE?read(env.QWEN_ACTIVATION_TOKEN_FILE).trim():env.QWEN_ACTIVATION_TOKEN;
 if(args.includes('--markup10'))throw new Error('LEGACY_MARKUP_DISABLED_USE_FIXED_PRICES');
 if(args.some(arg=>arg!=='--fixed-prices'&&arg!=='--apply'))throw new Error('UNKNOWN_ACTIVATION_ARGUMENT');
 const apply=args.includes('--apply'),markup=args.includes('--fixed-prices');
 if(apply&&!markup)throw new Error('FIXED_PRICES_REQUIRED_FOR_APPLY');
 async function request(path:string,method='GET',body?:unknown){
  if(!token)throw new Error('DEVAPP_OPERATOR_TOKEN_REQUIRED');
  const response=await fetcher(activationApiUrl(base,path),{method,headers:{authorization:`Bearer ${token}`,...(cookie?{cookie}:{}),'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){
   let code:unknown;try{const body=await response.json() as {message?:unknown};code=body.message;}catch{/* Never echo raw upstream body. */}
   if(code==='image_cny_quote_unconfigured'||code==='image_cny_quote_ambiguous')throw new Error(code.toUpperCase());
   throw new Error(`ACTIVATION_HTTP_${response.status}`);
  }
  return response.json();
 }
 let prices:ReturnType<typeof imageFixedCnyPrice>[]|undefined,quote:unknown;
 const snapshotFile=env.QWEN_ACTIVATION_CATALOG_SNAPSHOT;
 if(markup){
  if(env.QWEN_ACTIVATION_REGION!=='cn-beijing')throw new Error('VERIFIED_BEIJING_REGION_REQUIRED');
  if(!quoteOrgId)throw new Error('DEVAPP_QUOTE_CONTEXT_REQUIRED');
  quote=token?await request(`${nativeTariffOperations.getImagePricingBasis.path}?orgId=${encodeURIComponent(quoteOrgId!)}`):snapshotFile?JSON.parse(read(snapshotFile)):undefined;
  if(!quote)throw new Error('DEVAPP_OPERATOR_TOKEN_REQUIRED');
  const costs=[500000n,1000000n,250000n];prices=models.map((modelId,index)=>({modelId,...imageFixedCnyPrice(costs[index]!,quote)}));
  if(token&&snapshotFile){const snapshot=JSON.parse(read(snapshotFile));if(JSON.stringify(imageFixedCnyPrice(1n,quote))!==JSON.stringify(imageFixedCnyPrice(1n,snapshot)))throw new Error('CREDIT_QUOTE_CHANGED');}
  log(JSON.stringify({mode:apply?'proposed-apply':'dryrun',scope:'global',quoteSource:token?'live-devapp-catalog':'supplied-snapshot-not-live-verified',prices},null,2));
  if(!apply)return;
  // Re-read immediately before writes; stale or ambiguous quotes never change tariffs.
  const current=await request(`${nativeTariffOperations.getImagePricingBasis.path}?orgId=${encodeURIComponent(quoteOrgId!)}`);
  if(JSON.stringify(imageFixedCnyPrice(1n,current))!==JSON.stringify(imageFixedCnyPrice(1n,quote)))throw new Error('CREDIT_QUOTE_CHANGED');
 }
 const path=globalImageTariffOperations.list.path;
 const before=GlobalImageTariffSchedule.parse(await request(path));
 log(JSON.stringify({mode:'check',...before,missingModels:models.filter(model=>!before.items.some(row=>row.modelId===model))},null,2));
 if(!apply)return;
 if(!prices)throw new Error('FIXED_PRICES_REQUIRED_FOR_APPLY');
 const catalogVersion=prices[0]!.catalogVersion;
 const matches=(schedule:ReturnType<typeof GlobalImageTariffSchedule.parse>)=>models.every((model,index)=>schedule.items.some(row=>row.modelId===model&&row.catalogVersion===catalogVersion&&row.hundredthsPerQuantum===prices![index]!.hundredthsPerImage));
 // A matching schedule is already configured; repeated invocations must not append audits.
 if(matches(before)){log(JSON.stringify({configured:'global',revision:before.revision,unchanged:true}));return;}
 const body=globalImageTariffOperations.activate.in.parse({expectedRevision:before.revision,expectedCatalogVersion:catalogVersion});
 const saved=GlobalImageTariffSchedule.parse(await request(path,'PUT',body));
 if(!matches(saved))throw new Error('TARIFF_READBACK_MISMATCH');
 const readback=GlobalImageTariffSchedule.parse(await request(path));
 if(JSON.stringify(readback)!==JSON.stringify(saved))throw new Error('TARIFF_READBACK_MISMATCH');
 log(JSON.stringify({configured:'global',revision:saved.revision}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void runQwenImageActivation().catch(error=>{console.error(error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'ACTIVATION_FAILED');process.exitCode=1;});
