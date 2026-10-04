/** Compiled fixed module consumed by the already-open writer control session. */
import type pg from 'pg';
import {migrate}from './pinned-app-9b/migrator';
import type{PgConfig}from './pinned-app-9b/pg-config';
import{withExistingMigrationPeer,verifyMigrationPeer,approveExistingNoTls}from './pinned-app-9b/migration-pg';
import{verifyRdsTransportPreflight}from '../managed-data-preflight';
import{migrationSourceSchema,sourceEvidenceSchema,verifyExternalSourceIdentity,identityHash}from '../cn-migration-source-identity';
export async function migrateExistingSession(client:pg.Client,cfg:PgConfig,source:unknown,sourceEvidence:unknown,approvedException:unknown,dir:string,lockTimeoutMs:number){
 const target=migrationSourceSchema.parse(source);const evidence=sourceEvidenceSchema.parse(sourceEvidence);
 if(dir!=='/var/lib/workspacex-cn/releases/9b25bfa65662b96c0826fe67506b562ea46aa6d0/apps/api/migrations'||!Number.isSafeInteger(lockTimeoutMs)||lockTimeoutMs<1||lockTimeoutMs>300000||cfg.database!==target.database||cfg.user!==target.user||identityHash(cfg.host+':'+cfg.port)!==target.endpointSha256||!verifyExternalSourceIdentity(target,evidence))throw new Error('EXISTING_MIGRATION_INPUT_BINDING');
 if(target.sslMode==='verify-full'&&(!cfg.ssl||cfg.ssl.rejectUnauthorized!==true))throw new Error('EXISTING_MIGRATION_TLS_CONFIG');
 if(target.sslMode==='disable'&&cfg.ssl!==false)throw new Error('EXISTING_MIGRATION_TLS_CONFIG');
 return withExistingMigrationPeer(client,target,()=>migrate(cfg,{dir,lockTimeoutMs}),{sourceEvidence:evidence,approvedRdsTlsException:approvedException});
}

/** Shared socket/provider proof for control and borrowed recovery consumers.
 * Callers must obtain inputs from their pinned root-private source plan; this
 * function supplies no exception flag, connection, permission or READY. */
export interface ExistingMaintenanceTransportInput {source:unknown;sourceEvidence:unknown;approvedRdsTlsException?:unknown;sslResponse:unknown;allowlistResponse:unknown}
export function approveExistingMaintenanceTransportInputs(input:ExistingMaintenanceTransportInput){
 const source=migrationSourceSchema.parse(input.source),evidence=sourceEvidenceSchema.parse(input.sourceEvidence);
 if(!verifyExternalSourceIdentity(source,evidence))throw Error('MAINTENANCE_EXTERNAL_TRANSPORT_IDENTITY');
 if(source.sslMode==='disable'){
  const checks=verifyRdsTransportPreflight({region:source.regionId,rdsInstanceId:source.dbInstanceId,postgresHost:evidence.configuration.host,rdsTlsException:evidence.configuration.rdsTlsException},{attribute:evidence.attributeResponse,ssl:input.sslResponse,allowlist:input.allowlistResponse});
  if(checks.some(c=>!c.passed))throw Error('MAINTENANCE_EXISTING_EXCEPTION_PROVIDER_UNPROVEN');
  approveExistingNoTls(source,evidence,input.approvedRdsTlsException);
 }
 const endpoint=evidence.netInfoResponse.DBInstanceNetInfos.DBInstanceNetInfo.find(e=>e.IPType==='Private'&&e.VPCId===evidence.attributeResponse.Items.DBInstanceAttribute[0]!.VpcId&&e.ConnectionString===evidence.configuration.host&&Number(e.Port)===evidence.configuration.port)!;
 return {privateAddress:endpoint.IPAddress};
}
export function verifyExistingMaintenanceTransport(input:ExistingMaintenanceTransportInput,observed:{database:string;user:string;serverAddress:string|null;serverPort:number;remoteAddress:string;remotePort:number;encrypted:boolean;authorized:boolean;localAddress?:string}){
 approveExistingMaintenanceTransportInputs(input);const source=migrationSourceSchema.parse(input.source),evidence=sourceEvidenceSchema.parse(input.sourceEvidence);
 verifyMigrationPeer(source,observed,{sourceEvidence:evidence,approvedRdsTlsException:input.approvedRdsTlsException});
 return {sslMode:source.sslMode,configurationSha256:source.configurationSha256,providerEvidenceSha256:source.providerEvidenceSha256};
}

/** Fresh read-only provider responses reuse the existing serverless exception
 * verifier. The retained helper independently verifies its pinned source/socket
 * authority before calling this; no response boolean creates an exception. */
export function verifyFreshMaintenanceProviderTransport(input: ExistingMaintenanceTransportInput, live: {attribute:unknown;ssl:unknown;allowlist:unknown;network:unknown}) {
 approveExistingMaintenanceTransportInputs(input);
 const source=migrationSourceSchema.parse(input.source),prior=sourceEvidenceSchema.parse(input.sourceEvidence);
 const checks=verifyRdsTransportPreflight({region:source.regionId,rdsInstanceId:source.dbInstanceId,postgresHost:prior.configuration.host,rdsTlsException:prior.configuration.rdsTlsException},{attribute:live.attribute,ssl:live.ssl,allowlist:live.allowlist});
 if(checks.some(c=>!c.passed))throw Error('MAINTENANCE_FRESH_PROVIDER_TRANSPORT_REJECTED');
 const attribute=(live.attribute as any)?.Items?.DBInstanceAttribute;
 const nets=(live.network as any)?.DBInstanceNetInfos?.DBInstanceNetInfo;
 const pinned=prior.netInfoResponse.DBInstanceNetInfos.DBInstanceNetInfo.filter(e=>e.IPType==='Private'&&e.ConnectionString===prior.configuration.host&&Number(e.Port)===prior.configuration.port);
 if(!Array.isArray(attribute)||attribute.length!==1||!Array.isArray(nets)||pinned.length!==1)throw Error('MAINTENANCE_FRESH_PROVIDER_NETWORK_REJECTED');
 const matches=nets.filter((e:any)=>e.IPType==='Private'&&e.ConnectionString===prior.configuration.host&&Number(e.Port)===prior.configuration.port&&e.VPCId===attribute[0].VpcId&&e.IPAddress===pinned[0]!.IPAddress);
 if(matches.length!==1)throw Error('MAINTENANCE_FRESH_PROVIDER_NETWORK_REJECTED');
 const verified={instanceId:source.dbInstanceId,privateAddress:matches[0].IPAddress,port:Number(matches[0].Port),sslMode:source.sslMode,configurationSha256:source.configurationSha256,checks};
 return {...verified,providerEvidenceSha256:identityHash(JSON.stringify(verified))};
}
