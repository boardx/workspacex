import pg from 'pg';
import { deploymentInputSchema } from '../../config';
import { identityHash, migrationSourceSchema, sourceEvidenceSchema, verifyExternalSourceIdentity } from '../../cn-migration-source-identity';
type Source=ReturnType<typeof migrationSourceSchema.parse>;
interface Observed {database:string;user:string;serverAddress:string|null;serverPort:number;remoteAddress:string;remotePort:number;encrypted:boolean;authorized:boolean;localAddress?:string}
interface Context {existingClient?:pg.Client;source:Source; sourceEvidence?:unknown; approvedRdsTlsException?:unknown}
let active:Context|undefined;
const exceptionSchema=deploymentInputSchema.shape.environment.options[1].shape.rdsTlsException.unwrap();
function ipv4Number(address:string):number|undefined{if(!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address))return;const parts=address.split('.').map(Number);if(parts.some(p=>p>255))return;return parts.reduce((n,p)=>(n*256+p)>>>0,0);}
export function approveExistingNoTls(source:Source,sourceEvidence:unknown,approved:unknown,localAddress?:string):void{
 const evidence=sourceEvidenceSchema.parse(sourceEvidence);const exception=exceptionSchema.parse(approved);
 if(source.sslMode!=='disable'||!verifyExternalSourceIdentity(source,evidence)||JSON.stringify(exception)!==JSON.stringify(evidence.configuration.rdsTlsException))throw new Error('MIGRATION_NO_TLS_EXCEPTION_UNAPPROVED');
 if(localAddress!==undefined){const address=ipv4Number(localAddress.replace(/^::ffff:/,''));const permitted=address!==undefined&&exception.allowedCidrs.some(cidr=>{const [base,bits]=cidr.split('/');const prefix=ipv4Number(base!);const length=Number(bits);if(length<1||length>32)return false;const mask=(0xffffffff<<(32-length))>>>0;return prefix!==undefined&&(address&mask)===(prefix&mask);});if(!permitted)throw new Error('MIGRATION_NO_TLS_SOURCE_CIDR_MISMATCH');}
}

export function verifyMigrationPeer(expected:Source,observed:Observed,options?:{sourceEvidence?:unknown;approvedRdsTlsException?:unknown}):void {
 if(observed.database!==expected.database||observed.user!==expected.user||identityHash(observed.remoteAddress)!==expected.clientPeerAddressSha256||observed.remotePort!==expected.clientPeerPort||(expected.identityLane==='sql-server-address'&&(observed.serverAddress===null||identityHash(observed.serverAddress)!==expected.serverAddressSha256||observed.serverPort!==expected.port)))throw new Error('MIGRATION_LIVE_DATABASE_PEER_MISMATCH');
 if(expected.sslMode==='verify-full'){if(!observed.encrypted||!observed.authorized||!expected.clientEncrypted||!expected.clientTlsAuthorized)throw new Error('MIGRATION_LIVE_DATABASE_PEER_MISMATCH');}
 else{if(observed.encrypted||observed.authorized||expected.clientEncrypted||expected.clientTlsAuthorized||!observed.localAddress)throw new Error('MIGRATION_NO_TLS_EXCEPTION_UNAPPROVED');approveExistingNoTls(expected,options?.sourceEvidence,options?.approvedRdsTlsException,observed.localAddress);}
}
export async function withMigrationPeer<T>(source:unknown,operation:()=>Promise<T>,options?:{sourceEvidence?:unknown;approvedRdsTlsException?:unknown}):Promise<T>{if(active)throw new Error('MIGRATION_CONNECTION_CONTEXT_BUSY');const value=migrationSourceSchema.parse(source);if(value.sslMode==='disable')approveExistingNoTls(value,options?.sourceEvidence,options?.approvedRdsTlsException);active={source:value,...options};try{return await operation();}finally{active=undefined;}}
export async function withExistingMigrationPeer<T>(existingClient:pg.Client,source:unknown,operation:()=>Promise<T>,options?:{sourceEvidence?:unknown;approvedRdsTlsException?:unknown}):Promise<T>{if(active)throw new Error('MIGRATION_CONNECTION_CONTEXT_BUSY');const value=migrationSourceSchema.parse(source);if(value.sslMode==='disable')approveExistingNoTls(value,options?.sourceEvidence,options?.approvedRdsTlsException);active={existingClient,source:value,...options};try{return await operation();}finally{active=undefined;}}
class Client {
 private readonly client:pg.Client;
 private readonly borrowed:boolean;
 constructor(config:pg.ClientConfig){this.borrowed=!!active?.existingClient;this.client=active?.existingClient??new pg.Client(config);}
 async connect():Promise<void>{
  const expected=active;if(!expected)throw new Error('MIGRATION_CONNECTION_CONTEXT_REQUIRED');
  if(!this.borrowed)await this.client.connect();
  try{
   const result=await this.client.query("SELECT current_database() AS database,current_user AS \"user\",inet_server_addr()::text AS \"serverAddress\",inet_server_port() AS \"serverPort\"");
   const stream=(this.client as any).connection?.stream;
   if(result.rows.length!==1||!stream)throw new Error('MIGRATION_LIVE_DATABASE_PEER_MISSING');
   verifyMigrationPeer(expected.source,{...result.rows[0],remoteAddress:stream.remoteAddress,remotePort:stream.remotePort,encrypted:stream.encrypted===true,authorized:stream.authorized===true,localAddress:stream.localAddress},expected);
  }catch(error){if(!this.borrowed)await this.client.end();throw error;}
 }
 query<R extends pg.QueryResultRow=any>(sql:string,parameters?:any[]):Promise<pg.QueryResult<R>>{return this.client.query<R>(sql,parameters);}
 async end():Promise<void>{if(!this.borrowed)await this.client.end();}
}
export default {Client};
