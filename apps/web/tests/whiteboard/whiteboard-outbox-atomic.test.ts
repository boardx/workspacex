import {describe,expect,it} from 'vitest';
import {commitWhiteboardOutboxRebind,type CipherRow,type WhiteboardOutboxRebindTransaction} from '@/lib/whiteboard-outbox';

const row=(id:string,tokenHash:string):CipherRow=>({id,boardId:'board',tokenHash,iv:new ArrayBuffer(12),ciphertext:new ArrayBuffer(1),byteSize:1,createdAt:1});

function transaction(state:Map<string,CipherRow>,failAt:number|null):WhiteboardOutboxRebindTransaction{
  const staged=new Map(state);let boundary=0,aborted=false;
  const fault=()=>{if(failAt===boundary++)throw new Error('injected');};
  return{
    put(value){fault();staged.set(value.id,value);},
    delete(id){fault();staged.delete(id);},
    abort(){aborted=true;},
    done:Promise.resolve().then(()=>{fault();if(!aborted){state.clear();for(const [id,value] of staged)state.set(id,value);}}),
  };
}

describe('encrypted outbox authentication rebind',()=>{
  it('rolls back at every write/delete/commit crash boundary and restarts from one complete token generation',async()=>{
    const source=[row('old:a','old'),row('old:b','old')],replacement=[row('new:a','new'),row('new:b','new')];
    for(let failAt=0;failAt<5;failAt++){
      const state=new Map(source.map(value=>[value.id,value]));
      await expect(commitWhiteboardOutboxRebind(source,replacement,transaction(state,failAt))).rejects.toThrow('injected');
      expect([...state.keys()].sort()).toEqual(['old:a','old:b']);
      const restartedRows=[...state.values()];
      expect(restartedRows.every(value=>value.tokenHash==='old')).toBe(true);
      expect(restartedRows.some(value=>value.tokenHash==='new')).toBe(false);
    }
    const state=new Map(source.map(value=>[value.id,value]));
    await commitWhiteboardOutboxRebind(source,replacement,transaction(state,null));
    expect([...state.keys()].sort()).toEqual(['new:a','new:b']);
    expect([...state.values()].every(value=>value.tokenHash==='new')).toBe(true);
  });
});
