import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {STANDARD_TOOL_TRACE_IDENTITIES,toolTraceMetadata} from '../../src/application/agent-run/tool-trace-metadata';
import {ExecutionEvent} from '@repo/contracts/execution-journal';

describe('#3020 standard tool trace identity',()=>{
 it('binds every implemented T014..T046 identity to the catalog and an existing adapter factory',()=>{
  const root=new URL('../../../../',import.meta.url);
  const catalog=JSON.parse(readFileSync(new URL('docs/design/standard-capabilities/capability-catalog.json',root),'utf8'));
  const expected=catalog.capabilities.filter((item:{kind:string;id:string})=>item.kind==='tool'&&Number(item.id.slice(4))>=14&&Number(item.id.slice(4))<=46&&item.id!=='WX-T018');
  expect(STANDARD_TOOL_TRACE_IDENTITIES.map(([id,name])=>[id,name])).toEqual(expected.map((item:{id:string;canonical_name:string})=>[item.id,item.canonical_name]));
  for(const [id,name,locator] of STANDARD_TOOL_TRACE_IDENTITIES){
   const [path,factory]=locator.split(':');
   expect(readFileSync(new URL(path!,root),'utf8')).toContain(`def ${factory}(`);
   const trace=toolTraceMetadata(name,true);
   expect(trace).toMatchObject({capabilityId:id,implementationSource:{kind:'workspacex',locator,license:'Apache-2.0'}});
   expect(trace).not.toHaveProperty('implementationSource.revision');
   ExecutionEvent.parse({kind:'tool_end',runId:'r',seq:1,emittedAt:new Date().toISOString(),toolCallId:'call',toolName:name,result:{ok:true},ok:true,durationMs:3,...trace});
  }
 });
 it('does not attribute legacy, MCP or unknown names to standard native adapters',()=>{
  expect(toolTraceMetadata('wx_canvas_read',false)).toEqual({});
  expect(toolTraceMetadata('mcp__custom__wx_canvas_read',true)).toEqual({});
  expect(toolTraceMetadata('wx_attachment_mount',true)).toEqual({});
  expect(toolTraceMetadata('write_todos',true)).toMatchObject({capability:{id:'WX-T009'}});
 });
});
