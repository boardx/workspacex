import type {z} from 'zod';
import {StandardWebFailureReason} from '@repo/contracts/standard-web-tools';
export type StandardWebFailureReasonValue=z.infer<typeof StandardWebFailureReason>;
/**
 * issue #3204 ② —— 「为什么取不到这个网页」在服务端的载体。
 *
 * 此前这条信息被压平了三次：取回层只抛 `standard_web_response_refused`（丢掉 403）、
 * 控制器一个 `catch{}` 把所有成因收成同一个 503、Python 侧再把任意 503 映射成同一句话。
 * 结果是「上游拒绝」「域名不可达」「超时」「被我们自己的出站策略挡下」在产品里
 * **完全不可分辨**——人类实测报的那一条（openai.com 真实 `HTTP/2 403` +
 * `cf-mitigated: challenge`）因此没法从产品侧判性质。
 *
 * ⚠ 只带枚举与数字状态码，不带上游正文/响应头：可分辨不等于把上游内容透出去。
 */
export class StandardWebFailure extends Error {
 constructor(readonly reason:StandardWebFailureReasonValue,readonly upstreamStatus?:number){
  super(`standard_web_${reason}`);this.name='StandardWebFailure';
 }
}
const causes=(error:unknown):unknown[]=>{
 const chain:unknown[]=[];let current=error;
 for(let depth=0;current!==undefined&&current!==null&&depth<10;depth++){chain.push(current);current=(current as {cause?:unknown}).cause;}
 return chain;
};
/**
 * 把已知成因收敛成枚举。认不出来就老实说 `unknown`——**不许**猜成 `upstream_refused`，
 * 那会把"我们自己坏了"说成"网站拒绝了你"，比不可分辨更糟。
 */
export function classifyStandardWebFailure(error:unknown):StandardWebFailure{
 for(const link of causes(error)){
  if(link instanceof StandardWebFailure)return link;
  const named=link as {name?:unknown;message?:unknown};
  const name=typeof named?.name==='string'?named.name:'';
  const message=typeof named?.message==='string'?named.message:'';
  if(name==='GuardedFetchRefusedError'||message.includes('guarded fetch refused')||message.includes('unexpected redirect'))return new StandardWebFailure('blocked_by_policy');
  if(name==='TimeoutError'||name==='HeadersTimeoutError'||name==='BodyTimeoutError'||message.includes('signal timed out'))return new StandardWebFailure('timeout');
  if(name==='AbortError')return new StandardWebFailure('timeout');
  if(name==='ConnectTimeoutError')return new StandardWebFailure('timeout');
  if(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','CERT','ERR_TLS'].some(code=>message.includes(code)||String((link as {code?:unknown}).code??'').includes(code)))return new StandardWebFailure('upstream_unreachable');
 }
 return new StandardWebFailure('unknown');
}
