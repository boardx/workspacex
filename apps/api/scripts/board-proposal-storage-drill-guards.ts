import { deriveTestIsolation } from '../../../.harness/scripts/lib/test-isolation';
/** Guards are separate so tests never import or execute the real PG producer. */
export function assertProposalStorageDrill(env:NodeJS.ProcessEnv){
 if(env.BOARD_PROPOSAL_STORAGE_DRILL!=='1'||!env.WORKSPACEX_ISOLATION_ID||!/^wsx_[a-f0-9]{20}$/.test(env.WORKSPACEX_DB??'')||env.PGDATABASE!==env.WORKSPACEX_DB||!['localhost','127.0.0.1','::1'].includes(env.PGHOST??'')||env.WORKSPACEX_DEPLOY_PROFILE||!env.COMPOSE_PROJECT_NAME)throw Error('ISOLATED_LOCAL_DRILL_REQUIRED');
 if(!env.BOARD_PROPOSAL_DRILL_DIRECTORY)throw Error('PRIVATE_DRILL_DIRECTORY_REQUIRED');
}
export function assertRestoredDatabase(name:unknown):asserts name is string{
 if(typeof name!=='string'||!/^wsx_drill_[a-f0-9]{20}$/.test(name))throw Error('INVALID_RESTORED_DATABASE');
}
export function requireEvidence(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
export function proposalDrillFailure(stage:string,error:unknown){
 const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9_]{2,80}$/.test(error.code)?error.code:
  error instanceof Error&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)?error.message:'PROPOSAL_STORAGE_DRILL_FAILED';
 return{status:'failed',stage,code};
}

/** Bind the inspected, running compose service to the exact connection endpoint before any DB call. */
export function assertProposalDatabaseBinding(env:NodeJS.ProcessEnv,worktreePath:string,container:{id:string;project:string;service:string;running:boolean;ports:Array<{HostIp:string;HostPort:string}>},configs:Array<{host:string;port:number;database:string}>){
 const expected=deriveTestIsolation({worktreePath,isolationId:env.WORKSPACEX_ISOLATION_SEED??env.WORKSPACEX_ISOLATION_ID!});
 if(env.WORKSPACEX_ISOLATION_ID!==expected.WORKSPACEX_ISOLATION_ID||env.WORKSPACEX_DB!==expected.WORKSPACEX_DB||env.COMPOSE_PROJECT_NAME!==expected.COMPOSE_PROJECT_NAME)throw Error('ISOLATION_IDENTITY_MISMATCH');
 if(!container.id||container.project!==expected.COMPOSE_PROJECT_NAME||container.service!=='postgres'||!container.running||(env.STARTER_POSTGRES_CONTAINER&&env.STARTER_POSTGRES_CONTAINER!==container.id))throw Error('CONTAINER_OWNERSHIP_MISMATCH');
 const port=Number(env.PGPORT),host=env.PGHOST;
 if(!Number.isSafeInteger(port)||port<1||port>65535||!container.ports.some(p=>Number(p.HostPort)===port&&(p.HostIp===host||p.HostIp==='0.0.0.0'&&['localhost','127.0.0.1'].includes(host??'')||p.HostIp==='::'&&host==='::1')))throw Error('DATABASE_ENDPOINT_MISMATCH');
 if(configs.length!==2||configs.some(c=>c.host!==host||c.port!==port||c.database!==expected.WORKSPACEX_DB))throw Error('DATABASE_ENDPOINT_MISMATCH');
}
export async function requireNotFound(action:()=>Promise<unknown>){
 try{await action();}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='NOT_FOUND')return;throw error;}
 throw Error('OLD_AUTHORITY_NOT_REJECTED');
}
