import {createHash} from 'node:crypto';
import {Pool,type PoolConfig} from 'pg';
import {McpSealedExecutionEnvelope as Sealed} from '@repo/contracts/mcp-credential-envelope';
import {McpFrozenTool,MCP_EXECUTION_LIMITS as L} from '@repo/contracts/mcp-execution-snapshot';
import {executeSealedMcp,type McpExecutionCall,type McpExecutionOptions} from './http-mcp-execution';
import {mcpExecutionDigest} from './mcp-execution-digest';
import {MODEL_CREDENTIAL_KEY_ENV} from '../model/aes-credential-cipher';
/** A separate low-privilege connection. No public method returns sealed or plaintext secrets. */
export class McpCredentialExecutionBroker {
 readonly #pool:Pool;readonly #key:Buffer;readonly #keyId:string;
 constructor(config:PoolConfig,key:string,private options:McpExecutionOptions={}){
  if(config.connectionString||config.user!=='mcp_executor'||!config.password||!key)throw new Error('mcp_credential_broker_config_invalid');
  this.#pool=new Pool({...config,max:2,connectionTimeoutMillis:L.deadlineMs,statement_timeout:L.deadlineMs,query_timeout:L.deadlineMs,application_name:'mcp-credential-executor'});
  this.#pool.on('error',()=>{});
  this.#key=createHash('sha256').update(key,'utf8').digest();this.#keyId=`k-${this.#key.toString('hex').slice(0,8)}`;
 }
 readonly execute:McpExecutionCall=async(raw,args,control)=>{
  const frozen=McpFrozenTool.parse(raw),identity=control?.receipt;
  if(!identity||!frozen.credentialRevision||control.signal.aborted)throw new Error('mcp_credential_unavailable');
  try{
   const pending=this.#pool.query('SELECT ciphertext,algorithm,key_id,revision,endpoint FROM public.kernel_claim_mcp_credential($1,$2,$3,$4,$5,$6,$7,$8)',[identity.orgId,identity.runId,identity.toolCallId,identity.attemptId,identity.leaseEpoch,frozen.credentialRevision,frozen.runtime.name,mcpExecutionDigest(args)]);
   // pg queries cannot be reliably cancelled after dispatch. Aborting stops this
   // invocation immediately; a late DB claim is discarded and never starts a Worker.
   let abort:(()=>void)|undefined;
   const result=await Promise.race([pending,new Promise<never>((_,reject)=>{abort=()=>reject(new Error('aborted'));control.signal.addEventListener('abort',abort,{once:true});if(control.signal.aborted)abort();})]).finally(()=>{if(abort)control.signal.removeEventListener('abort',abort);});
   if(result.rows.length!==1)throw new Error('denied');
   const sealed=Sealed.parse(result.rows[0]);
   if(sealed.key_id!==this.#keyId||sealed.revision!==frozen.credentialRevision||sealed.endpoint!==frozen.endpoint||control.signal.aborted)throw new Error('denied');
   return await executeSealedMcp(frozen,args,{ciphertext:sealed.ciphertext,key:this.#key.toString('hex')},this.options,control);
  }catch{throw new Error('mcp_execution_unconfirmed');}
 };
 async close(){await this.#pool.end();this.#key.fill(0);}
 async onModuleDestroy(){await this.close();}
}
/** The existing sealing key remains the sole key configuration source. No secret defaults. */
export function mcpCredentialBrokerFromEnv():McpCredentialExecutionBroker|null{
 const user=process.env.MCP_EXECUTOR_DB_USER,password=process.env.MCP_EXECUTOR_DB_PASSWORD;
 if(!user&&!password)return null;
 if(user!=='mcp_executor'||!password||!process.env[MODEL_CREDENTIAL_KEY_ENV])throw new Error('mcp_credential_broker_config_invalid');
 return new McpCredentialExecutionBroker({host:process.env.PGHOST??'127.0.0.1',port:Number(process.env.PGPORT??55432),database:process.env.PGDATABASE??'workspacex',user,password},process.env[MODEL_CREDENTIAL_KEY_ENV]!);
}
