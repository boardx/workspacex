import {McpTool,parseMcpToolFullName} from '@repo/contracts/agent-runtime';
import {McpRuntimeTool} from '@repo/contracts/mcp-execution-snapshot';
import {fingerprint} from '../../application/mcp/discover-tools';
export function runtimeDescriptor(raw:unknown){
 const tool=McpTool.parse(raw),parts=parseMcpToolFullName(tool.fullName);
 if(!parts||!tool.inputSchema||tool.inputSchema.type!=='object')throw new Error('mcp_schema_unavailable');
 const actual=fingerprint(tool.signature,tool.sideEffect,{description:tool.description,inputSchema:tool.inputSchema,outputSchema:tool.outputSchema});
 const properties=tool.inputSchema.properties;
 if(properties&&typeof properties==='object'&&['runtime','config'].some(k=>Object.hasOwn(properties,k)))throw new Error('mcp_schema_reserved_argument');
 if(actual!==tool.schemaFingerprint)throw new Error('mcp_schema_changed');
 return McpRuntimeTool.parse({name:`mcp__${parts.serverSlug}__${parts.toolName}`,canonicalName:tool.fullName,description:tool.description??'',inputSchema:tool.inputSchema,...(tool.outputSchema?{outputSchema:tool.outputSchema}:{}),schemaFingerprint:actual});
}
