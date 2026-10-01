import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import * as Y from 'yjs';
import {createWhiteboardDocument,executeCommands,readObjects,WhiteboardUndo} from '@repo/whiteboard-core';
import {WhiteboardProvider,bytesToBase64,type WhiteboardConnectionState} from '@/lib/whiteboard-provider';
import {IndexedDbEncryptedWhiteboardOutbox} from '@/lib/whiteboard-outbox';
vi.mock('@/lib/api-client',()=>({getStoredSessionToken:()=> 'same-session',apiWebSocketUrl:()=> 'ws://localhost/board'}));
class Socket{
 static OPEN=1;static sockets:Socket[]=[];readyState=1;sent:string[]=[];onopen?:()=>void;onclose?:(event:{code:number})=>void;onmessage?:(event:{data:string})=>void;
 constructor(){Socket.sockets.push(this);}send(data:string){this.sent.push(data);}close(){this.readyState=3;}message(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
}
const providers:WhiteboardProvider[]=[],stores:IndexedDbEncryptedWhiteboardOutbox[]=[],docs:Y.Doc[]=[];
const store=()=>{const value=new IndexedDbEncryptedWhiteboardOutbox('board');stores.push(value);return value;};
const doc=()=>{const value=createWhiteboardDocument();docs.push(value);return value;};
const sync=(socket:Socket,server:Y.Doc,role='editor',archived=false)=>socket.message({type:'sync',epoch:1,seq:0,role,archived,update:bytesToBase64(Y.encodeStateAsUpdate(server))});
const writes=(socket:Socket)=>socket.sent.map(value=>JSON.parse(value)).filter(value=>['update','restore-deletion'].includes(value.type));
beforeEach(()=>{Socket.sockets=[];vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{providers.splice(0).forEach(value=>value.close());stores.splice(0).forEach(value=>value.close());docs.splice(0).forEach(value=>value.destroy());vi.unstubAllGlobals();});
it.each([['viewer',false],['commenter',false],['editor',true]] as const)('retires offline delete/undo/redo after confirmed %s archived=%s and regrant cannot replay it',async(role,archived)=>{
 const server=doc();executeCommands(server,[{type:'create',object:{id:'note',schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:180,height:180,rotation:0},text:'authoritative',style:{},parentId:null,orderKey:'a'}}],{});
 const local=doc(),first=new WhiteboardProvider(local,'board',()=>{},store());providers.push(first);await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(1));const socket=Socket.sockets[0]!;sync(socket,server);socket.onclose?.({code:1006});
 const undo=new WhiteboardUndo(local,{gestureId:'delete'});undo.execute([{type:'delete',id:'note'}]);expect(undo.undo('undo')).toBe('undone');expect(undo.redo('redo')).toBe(true);
 const stale=store();await vi.waitFor(async()=>expect((await stale.restore('same-session')).updates.map(value=>value.type)).toEqual(['update','restore-deletion','update']));first.close();undo.destroy();
 let denied!:WhiteboardConnectionState;const second=new WhiteboardProvider(doc(),'board',value=>{denied=value;},store());providers.push(second);await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(2));sync(Socket.sockets[1]!,server,role,archived);
 await vi.waitFor(()=>expect(denied).toMatchObject({phase:'blocked',reason:'WRITE_DENIED',pending:0}));await vi.waitFor(async()=>expect(await stale.restore('same-session')).toEqual({revoked:true,updates:[]}));
 const freshDoc=doc();let granted!:WhiteboardConnectionState;const third=new WhiteboardProvider(freshDoc,'board',value=>{granted=value;},store());providers.push(third);await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(3));sync(Socket.sockets[2]!,server);await vi.waitFor(()=>expect(granted).toMatchObject({phase:'online',pending:0}));expect(writes(Socket.sockets[2]!)).toEqual([]);expect(readObjects(freshDoc)).toEqual(readObjects(server));
 await expect(stale.persist('same-session',{type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:'late-tab',update:bytesToBase64(Y.encodeStateAsUpdate(server))})).rejects.toThrow('OUTBOX_REVOKED');
});
it('keeps pending drafts for a recoverable transport failure',async()=>{
 const server=doc(),local=doc(),outbox=store();let state!:WhiteboardConnectionState;const provider=new WhiteboardProvider(local,'board',value=>{state=value;},outbox);providers.push(provider);await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(1));const socket=Socket.sockets[0]!;sync(socket,server);
 executeCommands(local,[{type:'create',object:{id:'draft',schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:180,height:180,rotation:0},text:'keep',style:{},parentId:null,orderKey:'a'}}],{});await vi.waitFor(async()=>expect((await outbox.restore('same-session')).updates).toHaveLength(1));socket.message({type:'error',code:'DEPENDENCY_UNAVAILABLE',recoverable:true});expect(state.phase).toBe('offline');expect((await outbox.restore('same-session')).revoked).toBe(false);expect((await outbox.restore('same-session')).updates).toHaveLength(1);
});
