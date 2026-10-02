import {expect,it} from 'vitest';
import {sharedOutboxProof} from '../../e2e/support/board-shared-outbox-proof';
const sent=(client:string,id:string)=>({client,direction:'sent',type:'update',updateId:id});
const ack=(client:string,id:string,seq:number)=>({client,direction:'received',type:'ack',updateId:id,seq});
const valid=()=>[sent('original','a'),sent('original','b'),sent('peer','b'),ack('original','a',1),ack('original','b',2),ack('peer','b',2)];
it('accepts shared replay only when each tab receives the same persisted sequence',()=>expect(sharedOutboxProof(valid(),0,2)).toEqual([]));
it('accepts explicit distinct closed-origin receipts without weakening shared defaults',()=>{
 const events=[sent('peer','a'),sent('peer','b'),ack('peer','a',1),ack('peer','b',2)];
 expect(sharedOutboxProof(events,0,2,'distinct')).toEqual([]);
 expect(sharedOutboxProof(events,0,2)).toContain('NO_SHARED_REPLAY_OBSERVED');
 expect(sharedOutboxProof([...events,sent('original','a')],0,2,'distinct')).toContain('UNEXPECTED_SHARED_REPLAY');
 expect(sharedOutboxProof(events.filter(event=>event.updateId!=='b'||event.type!=='ack'),0,2,'distinct')).toContain('MISSING_OR_DIVERGENT_ACK');
 expect(sharedOutboxProof(events,0,3,'distinct')).toContain('DUPLICATE_OR_MISSING_COMMIT');
});
it.each(['missing-peer','missing-ack','duplicate-commit','divergent-ack','error'] as const)('rejects %s instead of inferring success from equal objects',mode=>{
 let events=valid();let final=2;
 if(mode==='missing-peer')events=events.filter(event=>event.client!=='peer');
 if(mode==='missing-ack')events=events.filter(event=>!(event.client==='peer'&&event.type==='ack'));
 if(mode==='duplicate-commit'){events.push(ack('peer','b',3));final=3;}
 if(mode==='divergent-ack')events.push(ack('original','a',2));
 if(mode==='error')events.push({client:'peer',direction:'received',type:'error',updateId:''});
 expect(sharedOutboxProof(events,0,final)).not.toEqual([]);
});
