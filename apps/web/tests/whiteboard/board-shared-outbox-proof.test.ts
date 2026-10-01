import {expect,it} from 'vitest';
import {sharedOutboxProof} from '../../e2e/support/board-shared-outbox-proof';
const sent=(client:string,id:string)=>({client,direction:'sent',type:'update',updateId:id});
const ack=(client:string,id:string,seq:number)=>({client,direction:'received',type:'ack',updateId:id,seq});
const valid=()=>[sent('original','a'),sent('original','b'),sent('peer','b'),ack('original','a',1),ack('original','b',2),ack('peer','b',2)];
it('accepts shared replay only when each tab receives the same persisted sequence',()=>expect(sharedOutboxProof(valid(),0,2)).toEqual([]));
it.each(['missing-peer','missing-ack','duplicate-commit','divergent-ack','error'] as const)('rejects %s instead of inferring success from equal objects',mode=>{
 let events=valid();let final=2;
 if(mode==='missing-peer')events=events.filter(event=>event.client!=='peer');
 if(mode==='missing-ack')events=events.filter(event=>!(event.client==='peer'&&event.type==='ack'));
 if(mode==='duplicate-commit'){events.push(ack('peer','b',3));final=3;}
 if(mode==='divergent-ack')events.push(ack('original','a',2));
 if(mode==='error')events.push({client:'peer',direction:'received',type:'error',updateId:''});
 expect(sharedOutboxProof(events,0,final)).not.toEqual([]);
});
