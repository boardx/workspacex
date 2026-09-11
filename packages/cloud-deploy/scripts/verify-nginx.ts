import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCloudNginxConfig } from "../src/nginx.js";
const [nginxImage, nodeImage] = process.argv.slice(2);
if (!nginxImage?.includes("@sha256:") || !nodeImage?.includes("@sha256:")) throw new Error("Supply cached nginx and node digest references");
const directory = mkdtempSync(join(tmpdir(), "wsx-nginx-"));
const name = `wsx-nginx-${process.pid}`;
const run = (command: string, args: string[]) => execFileSync(command, args, { timeout: 60000, stdio: "pipe" }).toString();
try {
  writeFileSync(join(directory, "default.conf"), createCloudNginxConfig({ domain: "workspace.example.com", certificateFile: "/fixture/cert.pem", certificateKeyFile: "/fixture/key.pem" }));
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=workspace.example.com", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")]);
  writeFileSync(join(directory, "probe.mjs"), `
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
const servers = [3000,3200].map(port => {
 const server = http.createServer((req,res) => {
   if (req.url === '/stream') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.write('data: ready\\n\\n'); return; }
   res.end(JSON.stringify({port,url:req.url,proto:req.headers['x-forwarded-proto']}));
 });
 server.on('upgrade',(req,socket) => socket.end('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n'));
 return server;
});
await Promise.all(servers.map((server,i)=>new Promise(resolve=>server.listen([3000,3200][i],'127.0.0.1',resolve))));
const request = (path, headers={}) => new Promise((resolve,reject) => {
 const req=https.get({host:'127.0.0.1',port:443,path,rejectUnauthorized:false,headers:{Host:'workspace.example.com',...headers}},res=>{
  res.once('data',data=>{ resolve({status:res.statusCode,body:data.toString()}); res.destroy(); });
 });
 req.on('upgrade',(res,socket)=>{resolve({status:res.statusCode});socket.destroy();});
 req.setTimeout(3000,()=>req.destroy(new Error('Ingress timeout')));req.on('error',reject);
});
for (const [path,port,url] of [['/api/copilotkit',3000,'/api/copilotkit'],['/api/copilotkit/stream?x=1',3000,'/api/copilotkit/stream?x=1'],['/api/health?x=1',3200,'/health?x=1'],['/',3000,'/'],['/.well-known/workspacex-deployment',3000,'/.well-known/workspacex-deployment']]) {
 const result=await request(path); assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.body),{port,url,proto:'https'});
}
assert.equal((await request('/api/ws',{Connection:'Upgrade',Upgrade:'websocket'})).status,101);
assert.equal((await request('/api/stream')).body,'data: ready\\n\\n');
console.log('PASS actual TLS ingress: Copilot exact/subpath, API prefix/query, Web, WebSocket upgrade, unbuffered SSE');
servers.forEach(server=>server.closeAllConnections());servers.forEach(server=>server.close());
`);
  const mounts = ["--mount", `type=bind,src=${directory},dst=/fixture,readonly`, "--mount", `type=bind,src=${join(directory,"default.conf")},dst=/etc/nginx/conf.d/default.conf,readonly`];
  run("docker", ["run", "--rm", "--pull=never", "--network=none", ...mounts, nginxImage, "nginx", "-t"]);
  run("docker", ["run", "-d", "--name", name, "--pull=never", "--network=none", "--memory=64m", ...mounts, nginxImage]);
  process.stdout.write(run("docker", ["run", "--rm", "--pull=never", `--network=container:${name}`, "--memory=128m", "--mount", `type=bind,src=${directory},dst=/fixture,readonly`, nodeImage, "node", "/fixture/probe.mjs"]));
} finally {
  try { run("docker", ["rm", "-f", name]); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
