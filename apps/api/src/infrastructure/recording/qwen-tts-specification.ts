import {createHash} from 'node:crypto';
import {Request,BILLING_MODES,type BillingMode} from '@repo/contracts/qwen-tts';
import {priceNativeAiUsage,type AiNativePrice} from '../../domain/agent-run/ai-billable-unit';

export interface QwenTtsDeploymentSpecification {
 readonly runtimeModelId:string;
 /** Deployment-confirmed voices and transport input bound, never inferred from a catalog name. */
 readonly allowedVoices:readonly string[];readonly maximumUtf8Bytes:number;
 readonly billingMode:BillingMode;
}
export interface PreparedQwenTtsRequest {
 readonly modelId:string;readonly serializedBody:string;readonly serializedBodySha256:string;
 readonly billingMode:QwenTtsDeploymentSpecification['billingMode'];
}
/** A validated request is not permission to call a supplier: ownership/admission remains required. */
export function prepareQwenTtsRequest(payload:unknown,specification:QwenTtsDeploymentSpecification):PreparedQwenTtsRequest {
 if(!BILLING_MODES.includes(specification.billingMode)||!specification.runtimeModelId||!Number.isSafeInteger(specification.maximumUtf8Bytes)||specification.maximumUtf8Bytes<=0
  ||specification.maximumUtf8Bytes>2_000_000||!specification.allowedVoices.length)
  throw new Error('TTS_DEPLOYMENT_SPECIFICATION_UNVERIFIED');
 const parsed=Request.safeParse(payload);
 if(!parsed.success)throw new Error('TTS_REQUEST_INVALID');
 const body=parsed.data;
 if(body.model!==specification.runtimeModelId||!specification.allowedVoices.includes(body.input.voice))throw new Error('TTS_DEPLOYMENT_BINDING_MISMATCH');
 const serializedBody=JSON.stringify(body);
 if(Buffer.byteLength(serializedBody,'utf8')>specification.maximumUtf8Bytes)throw new Error('TTS_TRANSPORT_INPUT_BOUND_EXCEEDED');
 return {modelId:body.model,serializedBody,serializedBodySha256:createHash('sha256').update(serializedBody).digest('hex'),billingMode:specification.billingMode};
}
export interface VerifiedQwenCharacterBound {
 readonly runtimeModelId:string;readonly serializedBodySha256:string;
 /** Verified provider billing counter covers this exact body, not JavaScript string length. */
 readonly maximumCharacters:bigint;readonly maximumDeploymentCharacters:bigint;
 readonly bindingVerified:true;readonly price:AiNativePrice;
}
/** Returns a finite native cost bound for reservation; does not dispatch or grant tenant access. */
export function priceQwenCharacterTtsBound(request:PreparedQwenTtsRequest,bound:VerifiedQwenCharacterBound):bigint {
 if(request.billingMode!=='character'||bound.bindingVerified!==true||bound.runtimeModelId!==request.modelId
  ||bound.serializedBodySha256!==request.serializedBodySha256||bound.maximumCharacters<=0n
  ||bound.maximumCharacters>bound.maximumDeploymentCharacters||bound.maximumDeploymentCharacters>9223372036854775807n
  ||bound.price.unit!=='character')throw new Error('TTS_CHARACTER_BOUND_UNVERIFIED');
 const cost=priceNativeAiUsage(bound.price,{kind:'native',unit:'character',quantity:bound.maximumCharacters,source:'reported'});
 if(cost===null)throw new Error('TTS_CHARACTER_PRICE_UNVERIFIED');
 return cost;
}
export type QwenTtsReportedUsage=
 |{readonly kind:'native';readonly unit:'character';readonly quantity:bigint|null;readonly source:'reported'|'unknown'}
 |{readonly kind:'token';readonly input:bigint|null;readonly output:bigint|null;readonly total:bigint|null;readonly audioOutput:bigint|null;readonly source:'reported'|'unknown'};
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const integer=(value:unknown):bigint|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?BigInt(value):null;
/** Read only a final, successful supplier result. SSE fragments must not be summed as independent bills.
 * Caller must bind this response to its physical request before settlement. This parser creates no identity.
 * Reference: https://help.aliyun.com/zh/model-studio/qwen-tts-api (retrieved 2026-10-05).
 */
export function readQwenTtsReportedUsage(payload:unknown,billingMode:QwenTtsDeploymentSpecification['billingMode']):QwenTtsReportedUsage {
 const unknownUsage:QwenTtsReportedUsage=billingMode==='character'?{kind:'native',unit:'character',quantity:null,source:'unknown'}:
  {kind:'token',input:null,output:null,total:null,audioOutput:null,source:'unknown'};
 const response=object(payload),output=object(response?.output);
 if(!response||response.status_code!==200||output?.finish_reason!=='stop')return unknownUsage;
 const usage=object(response.usage);
 if(!usage)return unknownUsage;
 if(billingMode==='character'){
  // Character-family placeholder zero Tokens never become reported Token consumption.
  if((usage.input_tokens!==undefined&&usage.input_tokens!==0)||(usage.output_tokens!==undefined&&usage.output_tokens!==0))return unknownUsage;
  const quantity=integer(usage.characters);
  return quantity===null?unknownUsage:{kind:'native',unit:'character',quantity,source:'reported'};
 }
 const input=integer(usage.input_tokens),outputTokens=integer(usage.output_tokens),total=integer(usage.total_tokens);
 const audioOutput=integer(object(usage.output_tokens_details)?.audio_tokens),textOutput=integer(object(usage.output_tokens_details)?.text_tokens);
 const textInput=integer(object(usage.input_tokens_details)?.text_tokens);
 if(input===null||outputTokens===null||total===null||input+outputTokens!==total||audioOutput===null||audioOutput!==outputTokens
  ||textOutput!==0n||textInput!==input||(usage.characters!==undefined&&usage.characters!==0))return unknownUsage;
 return {kind:'token',input,output:outputTokens,total,audioOutput,source:'reported'};
}
