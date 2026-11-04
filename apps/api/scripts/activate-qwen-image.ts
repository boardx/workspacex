/** Existing operator-only tariff API; default read-only. No SQL or supplier dispatch. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NativeCreditTariff,nativeTariffOperations} from '../../../packages/contracts/src/billing-consumption';
import {imageMarkup10Price} from '../src/domain/agent-run/image-activation-pricing';
const models=['qwen-image-3.0','qwen-image-3.0-pro','z-image-turbo'];
async function main(){
 const base=new URL(process.env.QWEN_ACTIVATION_BASE_URL??'https://devapp.boardx.us');
 if(base.protocol!=='https:'||base.hostname!=='devapp.boardx.us'||base.username||base.password||base.port||base.pathname!=='/'||base.search||base.hash)throw new Error('ACTIVATION_REQUIRES_DEVAPP_ORIGIN');
 const orgId=process.env.QWEN_ACTIVATION_ORG_ID;
 const cookie=process.env.QWEN_ACTIVATION_COOKIE_FILE?readFileSync(process.env.QWEN_ACTIVATION_COOKIE_FILE,'utf8').trim():process.env.QWEN_ACTIVATION_COOKIE;
 const apply=process.argv.includes('--apply'),markup=process.argv.includes('--markup10');
 async function request(path:string,method='GET',body?:unknown){
  if(!orgId||!cookie)throw new Error('DEVAPP_OPERATOR_ORG_AND_COOKIE_REQUIRED');
  const response=await fetch(new URL(path,base),{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new Error(`ACTIVATION_HTTP_${response.status}`);}
  return response.json();
 }
 let generated:unknown,quote:unknown;
 const snapshotFile=process.env.QWEN_ACTIVATION_CATALOG_SNAPSHOT;
 if(markup){
  if(process.env.QWEN_ACTIVATION_REGION!=='cn-beijing')throw new Error('VERIFIED_BEIJING_REGION_REQUIRED');
  if(!orgId)throw new Error('DEVAPP_ORG_REQUIRED');
  quote=cookie?await request('/billing/catalog'):snapshotFile?JSON.parse(readFileSync(snapshotFile,'utf8')):undefined;
  if(!quote)throw new Error('LIVE_CNY_CATALOG_REQUIRED');
  const costs=[180000n,500000n,100000n],prices=models.map((modelId,index)=>({modelId,...imageMarkup10Price(costs[index]!,quote)}));
  if(cookie&&snapshotFile){const snapshot=JSON.parse(readFileSync(snapshotFile,'utf8'));if(JSON.stringify(imageMarkup10Price(1n,quote))!==JSON.stringify(imageMarkup10Price(1n,snapshot)))throw new Error('CREDIT_QUOTE_CHANGED');}
  generated=prices.map(price=>({orgId,modelProvider:'bailian-image',modelId:price.modelId,unit:'image',quantum:'1',hundredthsPerQuantum:price.hundredthsPerImage,version:`image-cn-bj-10x-${createHash('sha256').update(JSON.stringify(price)).digest('hex').slice(0,24)}`}));
  console.log(JSON.stringify({mode:apply?'proposed-apply':'dryrun',quoteSource:cookie?'live-devapp-catalog':'supplied-snapshot-not-live-verified',prices,proposedTariffs:generated,sources:['https://help.aliyun.com/zh/model-studio/qwen-image-3-0','https://help.aliyun.com/zh/model-studio/qwen-image-3-0-pro','https://help.aliyun.com/zh/model-studio/z-image-turbo']},null,2));
  if(!apply)return;
  // Re-read immediately before writes; stale or ambiguous quotes never change tariffs.
  const current=await request('/billing/catalog');
  if(JSON.stringify(imageMarkup10Price(1n,current))!==JSON.stringify(imageMarkup10Price(1n,quote)))throw new Error('CREDIT_QUOTE_CHANGED');
 }
 const path=nativeTariffOperations.listNativeTariffs.path;
 const before=nativeTariffOperations.listNativeTariffs.out.parse(await request(`${path}?orgId=${encodeURIComponent(orgId!)}`));
 const wanted=before.items.filter(row=>row.modelProvider==='bailian-image'&&models.includes(row.modelId)&&row.unit==='image');
 console.log(JSON.stringify({mode:'check',orgId,tariffs:wanted,missingModels:models.filter(model=>!wanted.some(row=>row.modelId===model))},null,2));
 if(!apply)return;
 const file=process.argv[process.argv.indexOf('--apply')+1];if(!generated&&!file)throw new Error('APPROVED_TARIFF_FILE_REQUIRED');
 const raw:unknown=generated??JSON.parse(readFileSync(file!,'utf8'));if(!Array.isArray(raw)||raw.length!==3)throw new Error('EXACT_THREE_APPROVED_TARIFFS_REQUIRED');
 const approved=raw.map(row=>NativeCreditTariff.parse(row));
 if(new Set(approved.map(row=>row.modelId)).size!==3||approved.some(row=>row.orgId!==orgId||row.modelProvider!=='bailian-image'||!models.includes(row.modelId)||row.unit!=='image'||row.quantum!=='1'))throw new Error('TARIFF_SCOPE_MISMATCH');
 for(const row of approved){const saved=NativeCreditTariff.parse(await request(path,'PUT',row));if(JSON.stringify(saved)!==JSON.stringify(row))throw new Error('TARIFF_READBACK_MISMATCH');console.log(JSON.stringify({configured:saved.modelId,orgId,version:saved.version}));}
}
void main().catch(error=>{console.error(error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'ACTIVATION_FAILED');process.exitCode=1;});
