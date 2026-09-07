import {reflectsMcpCredential} from './mcp-credential-reflection';
import {createDecipheriv} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {McpInvokeOutput,MCP_EXECUTION_LIMITS as L,type McpFrozenTool} from '@repo/contracts/mcp-execution-snapshot';
import {parseMcpToolFullName} from '@repo/contracts/agent-runtime';
import type {z} from 'zod';
import {assertMcpEndpointAllowed,assertResolvedMcpAddressAllowed} from '../../domain/mcp/remote-endpoint-guard';
import {fingerprint} from '../../application/mcp/discover-tools';
import {signatureOf,sideEffectOf} from './http-mcp-gateway';
import {createManagedGuardedFetch,type GuardedFetchSeams} from './guarded-fetch';
export type McpExecutionCall=(tool:z.infer<typeof McpFrozenTool>,args:Record<string,unknown>)=>Promise<z.infer<typeof McpInvokeOutput>>;
/** Official MCP client/transport; no retry and no remote endpoint in model args. */
export function createHttpMcpExecutionCore(options:{seams?:GuardedFetchSeams;extraTrustedCa?:string|Buffer;timeoutMs?:number;sealed?:{ciphertext:string;key:string}}={}):McpExecutionCall{
 return async(frozen,args)=>{
  const credential=options.sealed?decryptForTransport(options.sealed):null;
  const endpoint=assertMcpEndpointAllowed(frozen.endpoint,{localOnlyOrg:false});
  const timeout=options.timeoutMs??L.deadlineMs,abort=new AbortController();
  const managed=createManagedGuardedFetch({connectTimeoutMs:timeout,seams:options.seams,extraTrustedCa:options.extraTrustedCa});
  let bytes=0;
  const bounded:typeof fetch=async(input,init)=>{
   const response=await managed.fetch(input,{...init,signal:AbortSignal.any([abort.signal,...(init?.signal?[init.signal]:[])])});
   if(!response.body)return response;
   const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>L.maxResultBytes){abort.abort();throw new Error('mcp_response_limit');}controller.enqueue(chunk);}}));
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  const client=new Client({name:'workspacex-mcp-executor',version:'1.0.0'});
  const transport=new StreamableHTTPClientTransport(endpoint,{fetch:bounded,requestInit:credential?{headers:{authorization:`Bearer ${credential}`}}:undefined,reconnectionOptions:{maxRetries:0,initialReconnectionDelay:0,maxReconnectionDelay:0,reconnectionDelayGrowFactor:1}});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const attempt=(async()=>{
   const validate=new AjvJsonSchemaValidator().getValidator(frozen.runtime.inputSchema);
   if(!validate(args).valid)throw new Error('mcp_arguments_invalid');
   await client.connect(transport,{timeout});
   const listed=await client.listTools(undefined,{timeout,signal:abort.signal});
   if(credential&&reflectsMcpCredential(listed,credential))throw new Error('mcp_secret_reflection');
   const name=parseMcpToolFullName(frozen.tool.fullName)?.toolName;
   const actual=listed.tools.find(t=>t.name===name);
   if(!actual||fingerprint(signatureOf(actual),sideEffectOf(actual),{description:actual.description,inputSchema:actual.inputSchema,outputSchema:actual.outputSchema})!==frozen.tool.schemaFingerprint)throw new Error('mcp_remote_schema_changed');
   const result=await client.callTool({name:name!,arguments:args},CallToolResultSchema,{timeout,signal:abort.signal});
   if(result.isError)throw new Error('mcp_remote_tool_failed');
   if(frozen.runtime.outputSchema){if(!result.structuredContent||!new AjvJsonSchemaValidator().getValidator(frozen.runtime.outputSchema)(result.structuredContent).valid)throw new Error('mcp_output_invalid');}
   if(credential&&reflectsMcpCredential(result,credential))throw new Error('mcp_secret_reflection');
   return McpInvokeOutput.parse(result);
  })();
  attempt.catch(()=>{});
  try{return await Promise.race([attempt,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('mcp_execution_unconfirmed'));},timeout);})]);}
  catch{throw new Error('mcp_execution_unconfirmed');}
  finally{if(timer)clearTimeout(timer);abort.abort();void client.close().catch(()=>{});await managed.close();}
 };
}

export {assertResolvedMcpAddressAllowed};
export function validateMcpSchemas(schemas:readonly {inputSchema:Record<string,unknown>;outputSchema?:Record<string,unknown>}[]){
 const validator=new AjvJsonSchemaValidator();
 for(const schema of schemas){validator.getValidator(schema.inputSchema);if(schema.outputSchema)validator.getValidator(schema.outputSchema);}
}

/** Module-private inverse, consumed only by the approved endpoint transport in its bounded Worker. */
function decryptForTransport(sealed:{ciphertext:string;key:string}):string {
 if(!/^[a-f0-9]{64}$/.test(sealed.key)||sealed.ciphertext.length>L.maxCredentialBytes*2+58)throw new Error('mcp_credential_invalid');
 const parts=sealed.ciphertext.split('.');
 if(parts.length!==3||!/^[a-f0-9]{24}$/.test(parts[0]!)||!/^[a-f0-9]{32}$/.test(parts[1]!)||!/^([a-f0-9]{2})+$/.test(parts[2]!))throw new Error('mcp_credential_invalid');
 const key=Buffer.from(sealed.key,'hex');let value:Buffer|undefined;
 try{const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(parts[0]!,'hex'));cipher.setAuthTag(Buffer.from(parts[1]!,'hex'));
  value=Buffer.concat([cipher.update(Buffer.from(parts[2]!,'hex')),cipher.final()]);
  if(value.length===0||value.length>L.maxCredentialBytes)throw new Error('mcp_credential_invalid');
  const credential=new TextDecoder('utf-8',{fatal:true}).decode(value);
  if(/[\r\n\0]/.test(credential))throw new Error('mcp_credential_invalid');
  return credential;
 }finally{key.fill(0);value?.fill(0);}
}
