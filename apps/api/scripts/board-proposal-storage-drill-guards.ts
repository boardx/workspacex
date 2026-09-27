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
