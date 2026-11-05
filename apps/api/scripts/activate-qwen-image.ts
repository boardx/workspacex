/** Existing operator-only tariff API; default read-only. No SQL or supplier dispatch. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {activationBaseUrl,activationApiUrl} from './qwen-image-activation-url';
import {createHash} from 'node:crypto';
import {NativeCreditTariff,nativeTariffOperations} from '../../../packages/contracts/src/billing-consumption';
import {imageMarkup10Price} from '../src/domain/agent-run/image-activation-pricing';
const models=['qwen-image-3.0','qwen-image-3.0-pro','z-image-turbo'];
export async function runQwenImageActivation(options:{env?:NodeJS.ProcessEnv;args?:readonly string[];fetcher?:typeof fetch;readFile?:(path:string)=>string;log?:(message:string)=>void}={}){
 const env=options.env??process.env,args=options.args??process.argv.slice(2),fetcher=options.fetcher??fetch,read=options.readFile??((path:string)=>readFileSync(path,'utf8')),log=options.log??console.log;
 const base=activationBaseUrl(env.QWEN_ACTIVATION_BASE_URL);
 if(env.QWEN_ACTIVATION_ORG_ID!==undefined)throw new Error('LEGACY_ORG_SCOPED_ACTIVATION_REMOVED');
 const cookie=env.QWEN_ACTIVATION_COOKIE_FILE?read(env.QWEN_ACTIVATION_COOKIE_FILE).trim():env.QWEN_ACTIVATION_COOKIE;
 const token=env.QWEN_ACTIVATION_TOKEN_FILE?read(env.QWEN_ACTIVATION_TOKEN_FILE).trim():env.QWEN_ACTIVATION_TOKEN;
 const apply=args.includes('--apply'),markup=args.includes('--markup10');
 if(apply&&!markup)throw new Error('MARKUP10_REQUIRED_FOR_APPLY');
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
 let generated:unknown,quote:unknown;
 const snapshotFile=env.QWEN_ACTIVATION_CATALOG_SNAPSHOT;
 if(markup){
  if(env.QWEN_ACTIVATION_REGION!=='cn-beijing')throw new Error('VERIFIED_BEIJING_REGION_REQUIRED');
  quote=token?await request(nativeTariffOperations.getImagePricingBasis.path):snapshotFile?JSON.parse(read(snapshotFile)):undefined;
  if(!quote)throw new Error('DEVAPP_OPERATOR_TOKEN_REQUIRED');
  const costs=[180000n,500000n,100000n],prices=models.map((modelId,index)=>({modelId,...imageMarkup10Price(costs[index]!,quote)}));
  if(token&&snapshotFile){const snapshot=JSON.parse(read(snapshotFile));if(JSON.stringify(imageMarkup10Price(1n,quote))!==JSON.stringify(imageMarkup10Price(1n,snapshot)))throw new Error('CREDIT_QUOTE_CHANGED');}
  generated=prices.map(price=>({modelProvider:'bailian-image',modelId:price.modelId,unit:'image',quantum:'1',hundredthsPerQuantum:price.hundredthsPerImage,version:`image-cn-bj-10x-${createHash('sha256').update(JSON.stringify(price)).digest('hex').slice(0,24)}`,pricingBasis:{source:'supplier-markup',markup:10,supplierRegion:price.region,supplierCurrency:price.currency,supplierMicros:price.supplierMicros,supplierQuantum:'1',catalogVersion:price.catalogVersion,sku:price.sku,amountMinor:price.amountMinor,credits:price.credits}}));
  log(JSON.stringify({mode:apply?'proposed-apply':'dryrun',quoteSource:token?'live-devapp-catalog':'supplied-snapshot-not-live-verified',prices,proposedTariffs:generated,sources:['https://help.aliyun.com/zh/model-studio/qwen-image-3-0','https://help.aliyun.com/zh/model-studio/qwen-image-3-0-pro','https://help.aliyun.com/zh/model-studio/z-image-turbo']},null,2));
  if(!apply)return;
  // Re-read immediately before writes; stale or ambiguous quotes never change tariffs.
  const current=await request(nativeTariffOperations.getImagePricingBasis.path);
  if(JSON.stringify(imageMarkup10Price(1n,current))!==JSON.stringify(imageMarkup10Price(1n,quote)))throw new Error('CREDIT_QUOTE_CHANGED');
 }
 const path=nativeTariffOperations.listNativeTariffs.path;
 const before=nativeTariffOperations.listNativeTariffs.out.parse(await request(path));
 const wanted=before.items.filter(row=>row.modelProvider==='bailian-image'&&models.includes(row.modelId)&&row.unit==='image');
 log(JSON.stringify({mode:'check',scope:'deployment-global',tariffs:wanted,missingModels:models.filter(model=>!wanted.some(row=>row.modelId===model))},null,2));
 if(!apply)return;
 const raw:unknown=generated;if(!Array.isArray(raw)||raw.length!==3)throw new Error('EXACT_THREE_APPROVED_TARIFFS_REQUIRED');
 const approved=raw.map(row=>NativeCreditTariff.parse(row));
 if(new Set(approved.map(row=>row.modelId)).size!==3||approved.some(row=>row.modelProvider!=='bailian-image'||!models.includes(row.modelId)||row.unit!=='image'||row.quantum!=='1'))throw new Error('TARIFF_SCOPE_MISMATCH');
 for(const row of approved){const saved=NativeCreditTariff.parse(await request(path,'PUT',row));if(JSON.stringify(saved)!==JSON.stringify(row))throw new Error('TARIFF_READBACK_MISMATCH');log(JSON.stringify({configured:saved.modelId,scope:'deployment-global',version:saved.version}));}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void runQwenImageActivation().catch(error=>{console.error(error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'ACTIVATION_FAILED');process.exitCode=1;});
