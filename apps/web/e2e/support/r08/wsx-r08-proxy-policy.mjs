import {createHash} from 'node:crypto';

export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function fixedUpstream(manifest){
  const port=manifest?.ports?.api;
  if(!Number.isInteger(port)||port<1024||port>65535||manifest.prepared!==true)throw new Error('INVALID_CANONICAL_API_MANIFEST');
  return `http://127.0.0.1:${port}`;
}
export function validateScope(scope){
  if(!/^[0-9a-f-]{36}$/i.test(scope?.boardId??'')||!Array.isArray(scope?.sessionHashes)||scope.sessionHashes.length!==2||scope.sessionHashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash))||new Set(scope.sessionHashes).size!==2)throw new Error('INVALID_OWNED_SCOPE');
  return {boardId:scope.boardId,sessionHashes:[...scope.sessionHashes]};
}
export function scopedSession(request,scope,bearerPrefix){
  if(typeof bearerPrefix!=='string'||!bearerPrefix.length)throw new Error('MISSING_CANONICAL_BEARER_PREFIX');
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.search||url.pathname!==`/v1/whiteboards/${scope.boardId}/sync`)return null;
  const protocols=String(request.headers['sec-websocket-protocol']??'').split(',').map(value=>value.trim());
  const candidates=protocols.filter(value=>value.startsWith(bearerPrefix));
  if(candidates.length!==1)return null;
  const sessionHash=sha256(candidates[0].slice(bearerPrefix.length));
  return scope.sessionHashes.includes(sessionHash)?sessionHash:null;
}
export class FaultPolicy{
  constructor(scope){this.scope=validateScope(scope);this.runId=crypto.randomUUID();this.denials=0;this.armed=false;this.events=[];this.dropped=0;}
  arm(){if(this.armed||this.denials)throw new Error('DENY_ONCE_ALREADY_USED');this.armed=true;}
  restore(){this.armed=false;}
  upgrade(sessionHash,connectionId){
    if(!this.scope.sessionHashes.includes(sessionHash))throw new Error('UNREGISTERED_SESSION');
    const status=this.armed?503:101;
    if(this.armed){this.armed=false;this.denials++;}
    this.record({connectionId,event:'upgrade',status,sessionSha256:sessionHash});
    return status;
  }
  authorizeAttempt(sessionHash,connectionId){
    if(!this.scope.sessionHashes.includes(sessionHash))throw new Error('UNREGISTERED_SESSION');
    if(!this.armed)return true;
    this.upgrade(sessionHash,connectionId);return false;
  }
  confirmUpgrade(sessionHash,connectionId,status){
    if(!this.scope.sessionHashes.includes(sessionHash)||status!==101)throw new Error('INVALID_UPSTREAM_UPGRADE');
    this.record({connectionId,event:'upgrade',status,sessionSha256:sessionHash});
  }
  record(event){if(this.events.length>=128){this.dropped++;return;}this.events.push(event);}
  receipt(){return{runId:this.runId,boardSha256:sha256(this.scope.boardId),deniedUpgradeCount:this.denials,dropped:this.dropped,complete:this.dropped===0,requests:this.events.map(event=>({...event}))};}
}
