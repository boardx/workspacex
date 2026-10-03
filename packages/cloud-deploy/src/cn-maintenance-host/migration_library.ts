/** Compiled fixed module consumed by the already-open writer control session. */
import type pg from 'pg';
import {migrate}from './pinned-app-9b/migrator';
import type{PgConfig}from './pinned-app-9b/pg-config';
import{withExistingMigrationPeer}from './pinned-app-9b/migration-pg';
import{migrationSourceSchema,sourceEvidenceSchema,verifyExternalSourceIdentity,identityHash}from '../cn-migration-source-identity';
export async function migrateExistingSession(client:pg.Client,cfg:PgConfig,source:unknown,sourceEvidence:unknown,approvedException:unknown,dir:string,lockTimeoutMs:number){
 const target=migrationSourceSchema.parse(source);const evidence=sourceEvidenceSchema.parse(sourceEvidence);
 if(dir!=='/var/lib/workspacex-cn/releases/9b25bfa65662b96c0826fe67506b562ea46aa6d0/apps/api/migrations'||!Number.isSafeInteger(lockTimeoutMs)||lockTimeoutMs<1||lockTimeoutMs>300000||cfg.database!==target.database||cfg.user!==target.user||identityHash(cfg.host+':'+cfg.port)!==target.endpointSha256||!verifyExternalSourceIdentity(target,evidence))throw new Error('EXISTING_MIGRATION_INPUT_BINDING');
 if(target.sslMode==='verify-full'&&(!cfg.ssl||cfg.ssl.rejectUnauthorized!==true))throw new Error('EXISTING_MIGRATION_TLS_CONFIG');
 if(target.sslMode==='disable'&&cfg.ssl!==false)throw new Error('EXISTING_MIGRATION_TLS_CONFIG');
 return withExistingMigrationPeer(client,target,()=>migrate(cfg,{dir,lockTimeoutMs}),{sourceEvidence:evidence,approvedRdsTlsException:approvedException});
}
