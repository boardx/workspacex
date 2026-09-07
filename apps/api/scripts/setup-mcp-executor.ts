import {migrationConfig} from '../src/infrastructure/db/pg-config';
import {setupMcpExecutor} from '../src/infrastructure/mcp/setup-mcp-executor';
void setupMcpExecutor(migrationConfig(),process.env.MCP_EXECUTOR_DB_PASSWORD??'').catch(()=>{console.error('MCP executor setup failed');process.exitCode=1;});
