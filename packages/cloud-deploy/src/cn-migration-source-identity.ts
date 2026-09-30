/** External identity evidence is independently collected and stored in the protected expected binding. */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const port=z.number().int().min(1).max(65535);
export const migrationSourceSchema=z.object({accountId:id,regionId:id,dbInstanceId:id,database:id,user:id,
 endpointSha256:hash,serverAddressSha256:hash.nullable(),port:port.nullable(),
 identityLane:z.enum(["sql-server-address","aliyun-private-endpoint"]),clientPeerAddressSha256:hash,clientPeerPort:port,
 configurationSha256:hash,providerEvidenceSha256:hash,sslMode:z.enum(["disable","verify-full"]),clientEncrypted:z.boolean(),clientTlsAuthorized:z.boolean(),
}).strict();
const requestId=z.string().min(1);
const exception=z.object({kind:z.literal("aliyun-postgresql-serverless-no-tls"),allowedCidrs:z.array(z.string().min(1)).min(1).max(32)}).strict();
export const sourceEvidenceSchema=z.object({
 request:z.object({regionId:id,dbInstanceId:id}).strict(),
 configuration:z.object({sha256:hash,endpointSha256:hash,regionId:id,rdsInstanceId:id,host:z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),port,
  database:id,user:id,sslMode:z.enum(["disable","verify-full"]),rdsTlsException:exception.optional()}).strict(),
 stsResponse:z.object({RequestId:requestId,AccountId:id}).passthrough(),
 attributeResponse:z.object({RequestId:requestId,Items:z.object({DBInstanceAttribute:z.array(z.object({
  DBInstanceId:id,RegionId:id,Engine:z.literal("PostgreSQL"),InstanceNetworkType:z.literal("VPC"),
  DBInstanceNetType:z.literal("Intranet"),DBInstanceStatus:z.literal("Running"),ConnectionString:z.string().min(1),Port:z.string().regex(/^[0-9]+$/),VpcId:id,
 }).passthrough()).length(1)}).passthrough()}).passthrough(),
 netInfoResponse:z.object({RequestId:requestId,InstanceNetworkType:z.literal("VPC"),DBInstanceNetInfos:z.object({DBInstanceNetInfo:z.array(z.object({
  IPType:z.string(),VPCId:id,Port:z.string().regex(/^[0-9]+$/),ConnectionString:z.string(),IPAddress:z.string(),
 }).passthrough()).min(1).max(32)}).passthrough()}).passthrough(),
}).strict();
export type SourceIdentityEvidence=z.infer<typeof sourceEvidenceSchema>;
export const identityHash=(v:string)=>createHash("sha256").update(v).digest("hex");
function canonical(v:unknown):unknown {if(Array.isArray(v))return v.map(canonical);if(v!==null&&typeof v==="object")return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,value])=>[k,canonical(value)]));return v;}
export const providerIdentityDigest=(e:SourceIdentityEvidence)=>identityHash(JSON.stringify(canonical({request:e.request,stsResponse:e.stsResponse,attributeResponse:e.attributeResponse,netInfoResponse:e.netInfoResponse})));
function ipv4(s:string):number|undefined {if(isIP(s)!==4)return;return s.split(".").reduce((n,v)=>(n*256+Number(v))>>>0,0);}
function inCidr(ip:string,cidr:string):boolean {const [address,bits,...extra]=cidr.split("/");const n=address===undefined?undefined:ipv4(address),value=ipv4(ip),length=Number(bits);if(extra.length||n===undefined||value===undefined||!/^\d+$/.test(bits??"")||length<1||length>32)return false;const mask=(0xffffffff<<(32-length))>>>0;return (n&mask)===(value&mask);}
function privateAddress(ip:string):boolean{return ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"].some(c=>inCidr(ip,c));}
/** No payload-selected fallback: the protected expected binding authorizes exactly one lane. */
export function verifyExternalSourceIdentity(source:z.infer<typeof migrationSourceSchema>,e:SourceIdentityEvidence):boolean {
 const c=e.configuration,a=e.attributeResponse.Items.DBInstanceAttribute[0]!;
 if(c.regionId!==e.request.regionId||c.rdsInstanceId!==e.request.dbInstanceId||source.accountId!==e.stsResponse.AccountId||source.regionId!==e.request.regionId||source.dbInstanceId!==e.request.dbInstanceId
  ||a.DBInstanceId!==source.dbInstanceId||a.RegionId!==source.regionId||a.ConnectionString!==c.host||Number(a.Port)!==c.port
  ||source.database!==c.database||source.user!==c.user||source.configurationSha256!==c.sha256||source.sslMode!==c.sslMode
  ||source.endpointSha256!==c.endpointSha256||source.endpointSha256!==identityHash(`${c.host}:${c.port}`)||source.providerEvidenceSha256!==providerIdentityDigest(e))return false;
 const endpoints=e.netInfoResponse.DBInstanceNetInfos.DBInstanceNetInfo.filter(n=>n.IPType==="Private"&&n.ConnectionString===c.host&&Number(n.Port)===c.port&&n.VPCId===a.VpcId);
 if(endpoints.length!==1)return false;const n=endpoints[0]!;
 if(!privateAddress(n.IPAddress)||source.clientPeerAddressSha256!==identityHash(n.IPAddress)||source.clientPeerPort!==c.port)return false;
 if(c.sslMode==="disable"){
  if(source.clientEncrypted||source.clientTlsAuthorized||!c.rdsTlsException||!c.rdsTlsException.allowedCidrs.some(cidr=>inCidr(n.IPAddress,cidr)))return false;
 }else if(!source.clientEncrypted||!source.clientTlsAuthorized)return false;
 if(source.identityLane==="aliyun-private-endpoint")return source.serverAddressSha256===null&&source.port===null;
 return source.serverAddressSha256!==null&&source.port!==null;
}

/** Generate independent expectations from protected configuration metadata and complete provider responses.
 * The SQL audit is a separate prior read-only call; it never comes from the ledger collector being validated. */
export function deriveMigrationSourceIdentity(evidence:unknown,audit:unknown,lane:"sql-server-address"|"aliyun-private-endpoint") {
 const e=sourceEvidenceSchema.parse(evidence),a=z.object({schemaVersion:z.literal(1),readOnly:z.literal(true),
  configurationSha256:hash,configuredRegionId:id,configuredRdsInstanceId:id,endpointSha256:hash,database:id,user:id,serverAddressSha256:hash.nullable(),port:port.nullable(),
  clientPeerAddressSha256:hash,clientPeerPort:port,sslMode:z.enum(["disable","verify-full"]),clientEncrypted:z.boolean(),clientTlsAuthorized:z.boolean(),
 }).strict().parse(audit);
 const c=e.configuration;
 if(a.configuredRegionId!==c.regionId||a.configuredRdsInstanceId!==c.rdsInstanceId||a.configurationSha256!==c.sha256||a.endpointSha256!==c.endpointSha256||a.database!==c.database||a.user!==c.user||a.sslMode!==c.sslMode)throw new Error("MIGRATION_SNAPSHOT_PROTECTED_CONFIGURATION_MISMATCH");
 const s=migrationSourceSchema.parse({accountId:e.stsResponse.AccountId,regionId:e.request.regionId,dbInstanceId:e.request.dbInstanceId,
  database:c.database,user:c.user,endpointSha256:c.endpointSha256,serverAddressSha256:a.serverAddressSha256,port:a.port,
  identityLane:lane,clientPeerAddressSha256:a.clientPeerAddressSha256,clientPeerPort:a.clientPeerPort,configurationSha256:c.sha256,
  providerEvidenceSha256:providerIdentityDigest(e),sslMode:c.sslMode,clientEncrypted:a.clientEncrypted,clientTlsAuthorized:a.clientTlsAuthorized});
 if(!verifyExternalSourceIdentity(s,e))throw new Error("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");return {source:s,sourceEvidence:e};
}
