import {migrationConfig} from '../src/infrastructure/db/pg-config';
import {setupPgBossScheduler} from '../src/infrastructure/agent-run/setup-pg-boss-scheduler';
void setupPgBossScheduler(migrationConfig()).catch(()=>{console.error('standard scheduler setup failed');process.exitCode=1;});
