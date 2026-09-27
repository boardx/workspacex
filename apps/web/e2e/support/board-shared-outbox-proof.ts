/** Receipt-only cross-tab idempotency proof; no payloads, credentials or URLs. */
export function sharedOutboxProof(events:readonly Record<string,unknown>[],baselineSeq:number,finalSeq:number):string[]{
 const faults:string[]=[],sent=new Map<string,Set<string>>(),acks=new Map<string,Set<number>>();
 for(const event of events){
  if(event.direction==='socketerror'||event.type==='error')faults.push('TRANSPORT_ERROR');
  if(event.direction==='sent'&&event.type==='update'&&typeof event.updateId==='string'){
   const clients=sent.get(event.updateId)??new Set<string>();clients.add(String(event.client));sent.set(event.updateId,clients);
  }
  if(event.direction==='received'&&event.type==='ack'&&typeof event.updateId==='string'&&typeof event.seq==='number'){
   const seqs=acks.get(event.updateId)??new Set<number>();seqs.add(event.seq);acks.set(event.updateId,seqs);
  }
 }
 if(![...sent.values()].some(clients=>clients.has('original')&&clients.has('peer')))faults.push('NO_SHARED_REPLAY_OBSERVED');
 for(const [id,clients] of sent){
  if(acks.get(id)?.size!==1)faults.push('MISSING_OR_DIVERGENT_ACK');
  for(const client of clients)if(!events.some(event=>event.client===client&&event.direction==='received'&&event.type==='ack'&&event.updateId===id))faults.push('CLIENT_ACK_MISSING');
 }
 const seqs=[...sent.keys()].flatMap(id=>[...(acks.get(id)??[])]).sort((a,b)=>a-b);
 if(!sent.size||finalSeq-baselineSeq!==sent.size||seqs.some((seq,index)=>seq!==baselineSeq+index+1))faults.push('DUPLICATE_OR_MISSING_COMMIT');
 return [...new Set(faults)];
}
