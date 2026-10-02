import {createHmac,timingSafeEqual} from 'node:crypto';
export interface RecoveryAck {operationId:string;actorId:string;revision:number;stateHash:string;sentAt:string;acknowledgedAt:string;}
export interface SoakRecovery {clientId:string;disconnectedAt:string;reconnectedAt:string;beforeRevision:number;afterRevision:number;offlineMonotonicMs:number;observerHash:string;peerHashes:Array<{clientId:string;revision:number;stateHash:string}>;acknowledgements:RecoveryAck[];}
export interface RecoveryPhaseBody {version:1;sha:string;measurementSignature:string;startedAt:string;finishedAt:string;recoveries:SoakRecovery[];}
export type RecoveryPhase=RecoveryPhaseBody & {signature:string};
const signature=(body:RecoveryPhaseBody,key:string)=>createHmac('sha256',key).update(JSON.stringify(body)).digest('hex');
export function signRecoveryPhase(body:RecoveryPhaseBody,key:string):RecoveryPhase{return{...body,signature:signature(body,key)};}
/** Recovery is additional evidence. It cannot exempt any client from the measurement ledger. */
export function verifyRecoveryPhase(phase:RecoveryPhase,key:string,sha:string,measurementSignature:string,measurementFinishedAt:string,lastRevision:number,actors:Array<{userId:string;role:string}>):boolean{
 try{
  const {signature:actual,...body}=phase;
  if(key.length<32||!/^[a-f0-9]{64}$/.test(actual)||phase.version!==1||phase.sha!==sha||phase.measurementSignature!==measurementSignature
   ||!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(signature(body,key),'hex'))||phase.recoveries.length!==5)return false;
  const start=Date.parse(phase.startedAt),end=Date.parse(phase.finishedAt),measurementEnd=Date.parse(measurementFinishedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<measurementEnd||start-measurementEnd>30000||end<=start)return false;
  const byId=new Map(actors.map(actor=>[actor.userId,actor.role])),writers=new Set(actors.filter(actor=>actor.role!=='viewer').map(actor=>actor.userId));
  if(byId.size!==50||writers.size!==20||new Set(phase.recoveries.map(row=>row.clientId)).size!==5)return false;
  const operations=new Set<string>();let revision=lastRevision,previousEnd=start;
  for(const recovery of phase.recoveries){
   const disconnected=Date.parse(recovery.disconnectedAt),reconnected=Date.parse(recovery.reconnectedAt);
   if(byId.get(recovery.clientId)!=='viewer'||!Number.isFinite(disconnected)||!Number.isFinite(reconnected)||disconnected<previousEnd||reconnected>end||reconnected-disconnected<30000
    ||!Number.isFinite(recovery.offlineMonotonicMs)||recovery.offlineMonotonicMs<30000||recovery.beforeRevision!==revision||!/^[a-f0-9]{64}$/.test(recovery.observerHash))return false;
   const ackWriters=new Set<string>();
   for(const ack of recovery.acknowledgements){
    if(!ack.operationId||operations.has(ack.operationId)||!writers.has(ack.actorId)||ack.revision!==revision+1||!/^[a-f0-9]{64}$/.test(ack.stateHash)
     ||!Number.isFinite(Date.parse(ack.sentAt))||!Number.isFinite(Date.parse(ack.acknowledgedAt))||Date.parse(ack.sentAt)<disconnected||Date.parse(ack.acknowledgedAt)<Date.parse(ack.sentAt)||Date.parse(ack.acknowledgedAt)>reconnected)return false;
    operations.add(ack.operationId);ackWriters.add(ack.actorId);revision=ack.revision;
   }
   if(ackWriters.size!==20||recovery.afterRevision!==revision||!recovery.acknowledgements.length||recovery.acknowledgements.at(-1)!.stateHash!==recovery.observerHash)return false;
   if(recovery.peerHashes.length!==50||new Set(recovery.peerHashes.map(peer=>peer.clientId)).size!==50||recovery.peerHashes.some(peer=>!byId.has(peer.clientId)||peer.revision!==revision||peer.stateHash!==recovery.observerHash))return false;
   previousEnd=reconnected;
  }
  return true;
 }catch{return false;}
}
