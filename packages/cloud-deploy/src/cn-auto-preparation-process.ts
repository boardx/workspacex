/** Lifecycle shared by stage and collector subprocesses. Cancellation joins the
 * active detached groups before the CLI's independent owner cleanup runs. */
import type {ChildProcess} from 'node:child_process';
export class PreparationProcesses {
 cancelled=false;
 private children=new Map<ChildProcess,Promise<void>>();
 private cleanupChildren=new Set<ChildProcess>();
 private handlers=new Map<NodeJS.Signals,()=>void>();
 install(){for(const signal of ['SIGTERM','SIGINT','SIGHUP'] as NodeJS.Signals[]){const handler=()=>{if(this.cancelled)return;this.cancelled=true;void this.stop();};this.handlers.set(signal,handler);process.on(signal,handler);}}
 dispose(){for(const [signal,handler] of this.handlers)process.off(signal,handler);this.handlers.clear();}
 check(){if(this.cancelled)throw new Error('CN_AUTO_PREPARATION_CANCELLED');}
 track(child:ChildProcess,cleanup=false){
  if(cleanup)this.cleanupChildren.add(child);
  const joined=new Promise<void>(resolve=>{child.once('close',()=>{this.children.delete(child);this.cleanupChildren.delete(child);resolve();});});this.children.set(child,joined);
 }
 async stop(){
  const active=[...this.children];
  for(const [child] of active)if(!this.cleanupChildren.has(child))try{process.kill(-child.pid!,'SIGTERM');}catch{}
  const escalation=setTimeout(()=>{for(const [child] of active)if(this.children.has(child)&&!this.cleanupChildren.has(child))try{process.kill(-child.pid!,'SIGKILL');}catch{}},5000);
  try{await Promise.all(active.map(([,joined])=>joined));}finally{clearTimeout(escalation);}
 }
}
