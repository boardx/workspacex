import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {WebSocketServer} from 'ws';
import {expect,it} from 'vitest';
import {ConfiguredRealtimeAsrProvider} from '../../src/infrastructure/recording/configured-realtime-asr-provider';
import {recording} from '@repo/contracts';
it('manual mode waits for protocol session.finished after all finals, not the first text',async()=>{
 const server=createServer(),wss=new WebSocketServer({server});
 const frames:Record<string,unknown>[]=[];let finishedSent=false;
 wss.on('connection',ws=>ws.on('message',raw=>{
  const frame=JSON.parse(String(raw));frames.push(frame);
  if(frame.type==='session.finish'){
   ws.send(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'first',event_id:'1',transcript:'第一句'}));
   setTimeout(()=>{ws.send(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'second',event_id:'2',transcript:'Second sentence'}));finishedSent=true;ws.send(JSON.stringify({type:'session.finished'}));},25);
  }
 }));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const provider=new ConfiguredRealtimeAsrProvider({provider:'realtime',baseUrl:`ws://127.0.0.1:${(server.address() as AddressInfo).port}`,apiKey:'test',model:'fixture'});
  const finals:string[]=[],errors:string[]=[];
  const session=await provider.open({onPartial:()=>{},onFinal:t=>finals.push(t.text),onError:r=>errors.push(r),onClosed:()=>{}},recording.ASR_AUDIO_FORMAT,{turnDetection:'manual'});
  try{session.pushAudio(new Uint8Array(3200));await session.finish();expect(finishedSent).toBe(true);expect(finals).toEqual(['第一句','Second sentence']);expect(errors).toEqual([]);expect((frames[0]?.session as {turn_detection:unknown}|undefined)?.turn_detection).toBeNull();expect(frames.filter(f=>f.type==='input_audio_buffer.commit')).toHaveLength(1);}finally{session.abort();}
 }finally{for(const client of wss.clients)client.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('manual mode rejects peer close before session.finished even after receiving text',async()=>{
 const server=createServer(),wss=new WebSocketServer({server});
 wss.on('connection',ws=>ws.on('message',raw=>{if(JSON.parse(String(raw)).type==='session.finish'){ws.send(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',transcript:'partial completion'}));ws.close();}}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const provider=new ConfiguredRealtimeAsrProvider({provider:'realtime',baseUrl:`ws://127.0.0.1:${(server.address() as AddressInfo).port}`,apiKey:'test',model:'fixture'}),errors:string[]=[];
  const session=await provider.open({onPartial:()=>{},onFinal:()=>{},onError:r=>errors.push(r),onClosed:()=>{}},recording.ASR_AUDIO_FORMAT,{turnDetection:'manual'});
  try{session.pushAudio(new Uint8Array(3200));await session.finish();expect(errors).toContain('ASR_PROVIDER_UNAVAILABLE');}finally{session.abort();}
 }finally{for(const client of wss.clients)client.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('manual server-confirmed silence needs session.finished but no fabricated final text',async()=>{
 const server=createServer(),wss=new WebSocketServer({server});
 wss.on('connection',ws=>ws.on('message',raw=>{if(JSON.parse(String(raw)).type==='session.finish')ws.send(JSON.stringify({type:'session.finished'}));}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const provider=new ConfiguredRealtimeAsrProvider({provider:'realtime',baseUrl:`ws://127.0.0.1:${(server.address() as AddressInfo).port}`,apiKey:'test',model:'fixture'}),finals:string[]=[],errors:string[]=[];
  const session=await provider.open({onPartial:()=>{},onFinal:t=>finals.push(t.text),onError:r=>errors.push(r),onClosed:()=>{}},recording.ASR_AUDIO_FORMAT,{turnDetection:'manual'});
  try{session.pushAudio(new Uint8Array(3200));await session.finish();expect(finals).toEqual([]);expect(errors).toEqual([]);}finally{session.abort();}
 }finally{for(const client of wss.clients)client.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
