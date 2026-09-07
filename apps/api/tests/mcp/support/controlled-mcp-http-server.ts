import https from 'node:https';
import type {AddressInfo} from 'node:net';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {testTlsMaterial} from '../../support/tls';
/** Real remote handlers deliberately ignore transport cancellation to demonstrate unknown side effects. */
export async function controlledMcpServer(){
 const begun=new Set<string>(),done=new Set<string>(),release=new Map<string,()=>void>(),listeners=new Map<string,()=>void>();
 const tls=testTlsMaterial();
 const server=https.createServer({cert:tls.cert,key:tls.key},(req,res)=>{
  const mcp=new McpServer({name:'controlled-mcp',version:'1'});
  mcp.registerTool('wait',{description:'Controlled remote call',inputSchema:{label:z.string()},outputSchema:{label:z.string()},annotations:{readOnlyHint:true}},async({label})=>{
   begun.add(label);const wait=new Promise<void>(resolve=>release.set(label,resolve));listeners.get(label)?.();
   await wait;done.add(label);return {content:[{type:'text',text:label}],structuredContent:{label}};
  });
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  res.on('close',()=>{void transport.close();void mcp.close();});
  void mcp.connect(transport).then(()=>transport.handleRequest(req,res)).catch(()=>{if(!res.headersSent)res.writeHead(500).end();});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`https://allowed.example:${(server.address() as AddressInfo).port}/mcp`,
  started(label:string){return begun.has(label)?Promise.resolve():new Promise<void>(resolve=>listeners.set(label,resolve));},
  release(label:string){release.get(label)?.();},finished(label:string){return done.has(label);},
  async close(){for(const resolve of release.values())resolve();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 };
}
