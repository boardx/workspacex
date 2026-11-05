/* Launcher-only diagnostics, scoped to one isolated test stack. Off unless explicit. */
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import core from './chat-refresh-diagnostic-core.cjs';
const [role,...command]=process.argv.slice(2);
if (!['api','next'].includes(role) || !command.length || process.env.WSX_CHAT_REFRESH_DIAGNOSTICS!=='1' || !process.env.WORKSPACEX_ISOLATION_ID) throw new Error('isolated diagnostic launcher requires explicit opt-in');
const dir=resolve('e2e/__evidence__/chat-refresh-diagnostics');mkdirSync(dir,{recursive:true});
const write=core.boundedWriter(resolve(dir,`${role}-launcher.jsonl`));
const preload=resolve(dirname(fileURLToPath(import.meta.url)),'chat-refresh-diagnostic-core.cjs');
const child=spawn(command[0],command.slice(1),{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --require=${preload}`,WSX_CHAT_DIAGNOSTIC_FILE:resolve(dir,`${role}-http.jsonl`)}});
for (const stream of [child.stdout,child.stderr]) {
 let pending='';stream.on('data',data=>{
  pending+=data.toString();const lines=pending.split('\n');pending=lines.pop().slice(-4096);
  for(const line of lines){const safe=core.safeChildLine(line);if(safe)write(safe);}
 });
}
let stopped=false;
function killGroup(signal){try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}}
function stop(signal='SIGTERM'){
 if(stopped)return;stopped=true;killGroup(signal);
 // Keep the supervisor alive until its owned process group has been reaped.
 setTimeout(()=>killGroup('SIGKILL'),3000);
}
process.once('exit',()=>killGroup('SIGKILL'));
for(const signal of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.once(signal,()=>stop(signal));
child.once('error',()=>{write({event:'child-launch-error'});stop();process.exitCode=1;});
child.once('exit',(code,signal)=>{write({event:'child-exit',code,signal:['SIGTERM','SIGINT','SIGKILL'].includes(signal)?signal:null});stop();process.exitCode=code??1;});
