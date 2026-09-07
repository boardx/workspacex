import {randomUUID} from 'node:crypto';
import type dns from 'node:dns';
import {afterEach,expect,it} from 'vitest';
import {startLocalMcpHttpServer,type LocalMcpHttpServer} from './support/local-mcp-http-server';
import {testTlsMaterial} from '../support/tls';
import {createHttpMcpGateway} from '../../src/infrastructure/mcp/http-mcp-gateway';
import {createHttpMcpExecution} from '../../src/infrastructure/mcp/http-mcp-execution';
import {toContractTool} from '../../src/application/mcp/discover-tools';
import {runtimeDescriptor} from '../../src/infrastructure/mcp/mcp-execution-descriptor';
import {McpFrozenTool} from '@repo/contracts/mcp-execution-snapshot';
let server:LocalMcpHttpServer|undefined;
afterEach(async()=>{await server?.close();server=undefined;});
const lookup=((_host:string,options:{all?:boolean},cb:Function)=>options?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof dns.lookup;
async function frozen(){
 server=await startLocalMcpHttpServer('allowed.example');
 const discovered=await createHttpMcpGateway({credential:null,policy:{localOnlyOrg:false},extraTrustedCa:testTlsMaterial().cert.toString(),seams:{lookup,checkAddress:()=>{}}}).listTools('mcp-fixture',server.url);
 const tool=toContractTool('mcp-fixture',discovered.find(t=>t.name==='query_contact')!,'全体成员');
 return McpFrozenTool.parse({reviewId:randomUUID(),endpoint:server.url,tool,runtime:runtimeDescriptor(tool),whitelistEntry:{toolFullName:tool.fullName,state:'在授权范围内',elevationDecision:null}});
}
const options=()=>({extraTrustedCa:testTlsMaterial().cert.toString(),testNetwork:{lookupAddress:'127.0.0.1',allowPrivateAddress:true}});
it('official SDK worker really lists, fingerprints and executes HTTPS tool with structured output',async()=>{
 const tool=await frozen();
 expect(await createHttpMcpExecution(options())(tool,{company:'WorkspaceX'})).toMatchObject({content:[{type:'text',text:'queried WorkspaceX'}],structuredContent:{result:'queried WorkspaceX'}});
});
it('schema mutation and invalid arguments refuse without reporting tool success',async()=>{
 const tool=await frozen();
 await expect(createHttpMcpExecution(options())(tool,{company:123})).rejects.toThrow('unconfirmed');
 const changed=structuredClone(tool);changed.tool.schemaFingerprint='v2:'+'a'.repeat(64);
 await expect(createHttpMcpExecution(options())(changed,{})).rejects.toThrow('unconfirmed');
});
it('production DNS gate rejects loopback and worker deadline settles, leaving slots reusable',async()=>{
 const tool=await frozen();await server!.close();server=await startLocalMcpHttpServer('allowed.example');tool.endpoint=server.url;const before=server.connectionCount();
 await expect(createHttpMcpExecution({extraTrustedCa:testTlsMaterial().cert.toString(),testNetwork:{lookupAddress:'127.0.0.1'}})(tool,{})).rejects.toThrow('unconfirmed');
 expect(server!.connectionCount()).toBe(before);
 await expect(createHttpMcpExecution({...options(),timeoutMs:1})(tool,{})).rejects.toThrow('unconfirmed');
 expect(await createHttpMcpExecution(options())(tool,{})).toMatchObject({structuredContent:{result:'queried all'}});
});
it('bounded worker concurrency refuses excess calls and waits for terminated workers before reuse',async()=>{
 const tool=await frozen(),call=createHttpMcpExecution(options());
 const first=call(tool,{}),second=call(tool,{});
 await expect(call(tool,{})).rejects.toThrow('unavailable');
 expect(await Promise.all([first,second])).toHaveLength(2);
 await expect(call(tool,{company:'again'})).resolves.toMatchObject({structuredContent:{result:'queried again'}});
});
it('schema regex CPU cannot block the API thread and timed-out worker is terminated before slot reuse',async()=>{
 const original=await frozen(),evilTool=toContractTool('mcp-fixture',{name:'query_contact',signature:'query_contact(q)',sideEffect:'只读',inputSchema:{type:'object',properties:{q:{type:'string',pattern:'^(a+)+$'}},required:['q']}},'全体成员');
 const evil=McpFrozenTool.parse({...original,tool:evilTool,runtime:runtimeDescriptor(evilTool)});
 let ticked=false;const timer=setTimeout(()=>{ticked=true;},10);
 try{await expect(createHttpMcpExecution({...options(),timeoutMs:1000})(evil,{q:'a'.repeat(100)+'!'})).rejects.toThrow('unconfirmed');expect(ticked).toBe(true);}
 finally{clearTimeout(timer);}
 expect(await createHttpMcpExecution(options())(original,{})).toMatchObject({structuredContent:{result:'queried all'}});
});
