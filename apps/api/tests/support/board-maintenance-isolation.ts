/** Validate before Vitest's database global setup can connect or create a database. */
export function assertLocalMaintenanceAcceptance(env:NodeJS.ProcessEnv=process.env):void {
 if(!env.WORKSPACEX_ISOLATION_ID||!/^wsx_[a-f0-9]{20}$/.test(env.WORKSPACEX_DB??'')||env.PGDATABASE!==env.WORKSPACEX_DB||!['localhost','127.0.0.1','::1'].includes(env.PGHOST??'')||env.WORKSPACEX_DEPLOY_PROFILE)throw Error('ISOLATED_LOCAL_MAINTENANCE_ACCEPTANCE_REQUIRED');
}
