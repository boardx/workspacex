/* Test-only, fixed-field diagnostics. Never serialize incoming headers, body or URL. */
const fs = require('node:fs');
const http = require('node:http');
function routeKind(raw) {
 const path = String(raw ?? '').split('?')[0];
 if (path === '/healthz') return 'health';
 if (path === '/identity/me') return 'identity';
 if (path === '/favicon.ico') return 'static-probe';
 if (path === '/_next/static/chunks/app/layout.js') return 'root-layout-chunk';
 if (path === '/_next/static/chunks/app/chat/(v2)/layout.js') return 'chat-layout-chunk';
 if (path.startsWith('/_next/static/')) return 'other-static';
 if (path.startsWith('/api/copilotkit/')) return 'copilotkit';
 if (path.startsWith('/copilotkit/')) return 'copilotkit-upstream';
 if (path.startsWith('/agent-runs/')) return 'agent-run';
 if (/^\/chat\/threads\/[^/]+\/messages$/.test(path)) return 'messages';
 if (path.startsWith('/chat/threads')) return 'thread-api';
 if (path === '/chat' || /^\/chat\/thr-[^/]+$/.test(path)) return 'chat-document';
 return 'other';
}
function boundedWriter(file, limit = 1048576) {
 let bytes = 0, stopped = false;
 try {bytes=fs.statSync(file).size;}catch(error){if(error.code!=='ENOENT')stopped=true;}
 if(bytes>=limit-96)stopped=true;
 return value => {
  if (stopped) return;
  const line = JSON.stringify({at:Date.now(), ...value})+'\n';
  try {
  if (bytes + Buffer.byteLength(line) > limit-96) { stopped=true; const marker=JSON.stringify({at:Date.now(),event:'truncated'})+'\n';if(bytes+Buffer.byteLength(marker)<=limit)fs.appendFileSync(file,marker,{mode:0o600}); return; }
  bytes += Buffer.byteLength(line); fs.appendFileSync(file,line,{mode:0o600});
  } catch { stopped=true; } // Observation failure must never break the server request.
 };
}
function safeChildLine(line) {
 // All arbitrary error text, URLs, JSON fields and stack traces are dropped.
 const text=String(line).replace(/\x1b\[[0-9;]*m/g,'');
 if (/\bCompiling\b/.test(text)) return {event:'compiling'};
 if (/\bCompiled\b/.test(text)) {
  const ms=text.match(/\bin (\d+(?:\.\d+)?)(ms|s)\b/);
  return {event:'compiled',durationMs:ms?Number(ms[1])*(ms[2]==='s'?1000:1):null};
 }
 if (/\berror\b|\bexception\b|\bfailed\b|TypeError|ReferenceError|SyntaxError/i.test(text)) return {event:'child-error-line'};
 if (/\bwarn(?:ing)?\b/i.test(text)) return {event:'child-warning-line'};
 return null;
}
module.exports={routeKind,boundedWriter,safeChildLine};
if (process.env.WSX_CHAT_REFRESH_DIAGNOSTICS === '1' && process.env.WSX_CHAT_DIAGNOSTIC_FILE && process.env.WORKSPACEX_ISOLATION_ID) {
 const write=boundedWriter(process.env.WSX_CHAT_DIAGNOSTIC_FILE.replace(/\.jsonl$/,`-${process.pid}.jsonl`));
 const emit=http.Server.prototype.emit;
 const sockets=new Set(); let nextId=0, active=0;
 http.Server.prototype.emit=function(event,...args) {
  if(event==='connection') {const socket=args[0];sockets.add(socket);socket.once('close',()=>sockets.delete(socket));}
  if(event==='request') {
   const [req,res]=args,id=++nextId,start=Date.now(),route=routeKind(req.url); active++;
   write({event:'request',id,route,active,sockets:sockets.size,pid:process.pid});
   let done=false; const finish=kind=>{if(done)return;done=true;active--;write({event:kind,id,route,status:res.statusCode,elapsedMs:Date.now()-start,active,sockets:sockets.size,pid:process.pid});};
   res.once('finish',()=>finish('response-finish'));res.once('close',()=>finish('response-close'));
  }
  return emit.call(this,event,...args);
 };
}
