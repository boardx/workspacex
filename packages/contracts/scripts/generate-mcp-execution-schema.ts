import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {MCP_EXECUTION_LIMITS,McpInvokeInput,McpInvokeOutput,McpRunSnapshotView} from '../src/mcp-execution-snapshot';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({limits:MCP_EXECUTION_LIMITS,input:zodToJsonSchema(McpInvokeInput,opts),output:zodToJsonSchema(McpInvokeOutput,opts),snapshot:zodToJsonSchema(McpRunSnapshotView,opts)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/mcp_execution_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('MCP execution schema stale');}else writeFileSync(path,content);
