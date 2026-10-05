/**
 * uiux-r4：挂断后线程为空的根因之一——客户端 `stop()` 以前发完 session.stop 立刻关连接，
 * 服务端收尾时落库的最后一句（turn.persisted）永远到不了界面。这里用假 WebSocket 证明：
 * stop() 等到 session.closed 才返回，期间的 turn.persisted 照常回调；以及麦克风电平。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openOmniConversation, pcm16Level } from "@/lib/live-omni-conversation";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(e: { data?: unknown }) => void>>();
  constructor() { FakeSocket.last = this; setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0); }
  addEventListener(type: string, fn: (e: { data?: unknown }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (e: { data?: unknown }) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(listener => listener !== fn)); }
  emit(type: string, e: { data?: unknown }) { for (const fn of this.listeners.get(type) ?? []) fn(e); }
  send(data: unknown) {
    this.sent.push(data);
    if (typeof data === "string" && JSON.parse(data).type === "session.stop") {
      // 服务端：先落最后一句，再回 session.closed
      setTimeout(() => {
        this.emit("message", { data: JSON.stringify({ type: "turn.persisted", role: "user", messageId: "m-last" }) });
        this.emit("message", { data: JSON.stringify({ type: "session.closed" }) });
      }, 10);
    }
  }
  close() { this.readyState = 3; }
}

afterEach(() => vi.unstubAllGlobals());

function handlers() {
  return {
    onReady: vi.fn(), onUserSpeech: vi.fn(), onUserTranscript: vi.fn(), onAssistantTranscript: vi.fn(),
    onAssistantAudio: vi.fn(), onError: vi.fn(), onClosed: vi.fn(), onTurnPersisted: vi.fn(), onInputLevel: vi.fn(),
  };
}

describe("openOmniConversation — hangup settles before closing", () => {
  it("stop() waits for session.closed and still delivers the turn persisted during hangup", async () => {
    vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
    const h = handlers();
    let frameListener: ((f: Int16Array) => void) | null = null;
    const handle = await openOmniConversation({ threadId: "t-1", agentId: null }, h, {
      sessionToken: "tok",
      capture: async () => ({ onFrame: (l) => { frameListener = l; }, stop: async () => {}, sourceSampleRate: 16000 }),
    });
    frameListener!(new Int16Array([16384, -16384, 16384, -16384]));
    expect(h.onInputLevel).toHaveBeenLastCalledWith(1);
    await handle.stop();
    expect(h.onTurnPersisted).toHaveBeenCalledWith("user", "m-last");
    expect(h.onTurnPersisted.mock.invocationCallOrder[0]!).toBeLessThan(h.onClosed.mock.invocationCallOrder[0]!);
    expect(FakeSocket.last!.sent.some((d) => typeof d === "string" && d.includes("session.stop"))).toBe(true);
  });

  it("pcm16Level: silence is 0, loud is capped at 1", () => {
    expect(pcm16Level(new Int16Array(160))).toBe(0);
    expect(pcm16Level(new Int16Array([32767, -32768]))).toBe(1);
    expect(pcm16Level(new Int16Array([800, -800]))).toBeGreaterThan(0);
  });
});

it('releases microphone capture and the audio player on a remote socket close exactly once',async()=>{
 vi.stubGlobal('WebSocket',FakeSocket as unknown as typeof WebSocket);
 const closeAudio=vi.fn().mockResolvedValue(undefined);const stopSource=vi.fn();
 vi.stubGlobal('AudioContext',class {currentTime=0;destination={};resume=vi.fn();close=closeAudio;createBuffer(){return {duration:1,getChannelData:()=>new Float32Array(1)};}createBufferSource(){return {connect:vi.fn(),start:vi.fn(),stop:stopSource};}});
 const stopCapture=vi.fn().mockResolvedValue(undefined);const h=handlers();
 const handle=await openOmniConversation('board-poc',h,{sessionToken:'tok',capture:async()=>({onFrame:vi.fn(),stop:stopCapture,sourceSampleRate:16000})});
 FakeSocket.last!.emit('message',{data:JSON.stringify({type:'assistant.audio',audio:'AAA='})});
 FakeSocket.last!.readyState=3;FakeSocket.last!.emit('close',{});
 await vi.waitFor(()=>expect(stopCapture).toHaveBeenCalledTimes(1));expect(closeAudio).toHaveBeenCalledTimes(1);expect(stopSource).toHaveBeenCalledTimes(1);
 await handle.stop();FakeSocket.last!.emit('close',{});expect(stopCapture).toHaveBeenCalledTimes(1);expect(closeAudio).toHaveBeenCalledTimes(1);expect(h.onClosed).toHaveBeenCalledTimes(1);
});

it('stops capture that resolves after a remote close during microphone startup',async()=>{
 vi.stubGlobal('WebSocket',FakeSocket as unknown as typeof WebSocket);
 let resolveCapture!: (capture: {onFrame:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;sourceSampleRate:number})=>void;
 const pending=new Promise<{onFrame:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;sourceSampleRate:number}>(resolve=>{resolveCapture=resolve;});
 const h=handlers();const opened=openOmniConversation({threadId:'thread',agentId:'role'},h,{sessionToken:'tok',capture:()=>pending});
 const rejected=expect(opened).rejects.toMatchObject({kind:'connect-failed'});
 await vi.waitFor(()=>expect(FakeSocket.last!.sent.some(frame=>typeof frame==='string'&&frame.includes('session.start'))).toBe(true));
 FakeSocket.last!.readyState=3;FakeSocket.last!.emit('close',{});
 const stop=vi.fn().mockResolvedValue(undefined);const onFrame=vi.fn();resolveCapture({onFrame,stop,sourceSampleRate:16000});await rejected;
 expect(stop).toHaveBeenCalledTimes(1);expect(onFrame).not.toHaveBeenCalled();expect(h.onClosed).toHaveBeenCalledTimes(1);
});

it('releases resources on a server session.closed frame and ignores late microphone frames',async()=>{
 vi.stubGlobal('WebSocket',FakeSocket as unknown as typeof WebSocket);
 const h=handlers();const stop=vi.fn().mockResolvedValue(undefined);let frameListener!: (frame:Int16Array)=>void;
 const handle=await openOmniConversation('board-poc',h,{sessionToken:'tok',capture:async()=>({onFrame:listener=>{frameListener=listener;},stop,sourceSampleRate:16000})});
 FakeSocket.last!.emit('message',{data:JSON.stringify({type:'session.closed'})});await vi.waitFor(()=>expect(h.onClosed).toHaveBeenCalledTimes(1));
 const sent=FakeSocket.last!.sent.length;frameListener(new Int16Array([10]));expect(FakeSocket.last!.sent).toHaveLength(sent);expect(h.onInputLevel).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledTimes(1);expect(FakeSocket.last!.readyState).toBe(3);await handle.stop();expect(stop).toHaveBeenCalledTimes(1);
});

it('still closes playback when microphone stop rejects on remote close',async()=>{
 vi.stubGlobal('WebSocket',FakeSocket as unknown as typeof WebSocket);const closeAudio=vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('AudioContext',class {currentTime=0;destination={};resume=vi.fn();close=closeAudio;createBuffer(){return {duration:1,getChannelData:()=>new Float32Array(1)};}createBufferSource(){return {connect:vi.fn(),start:vi.fn(),stop:vi.fn()};}});
 const h=handlers();await openOmniConversation('board-poc',h,{sessionToken:'tok',capture:async()=>({onFrame:vi.fn(),stop:vi.fn().mockRejectedValue(new Error('stop failed')),sourceSampleRate:16000})});
 FakeSocket.last!.emit('message',{data:JSON.stringify({type:'assistant.audio',audio:'AAA='})});FakeSocket.last!.readyState=3;FakeSocket.last!.emit('close',{});await vi.waitFor(()=>expect(h.onClosed).toHaveBeenCalledTimes(1));expect(closeAudio).toHaveBeenCalledTimes(1);
});

it('keeps speaking until the last scheduled audio source ends, even after upstream audio_done', async () => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  const sources: Array<{onended: (() => void) | null; start: ReturnType<typeof vi.fn>}> = [];
  vi.stubGlobal('AudioContext', class {
    currentTime = 0; destination = {}; resume = vi.fn(); close = vi.fn();
    createBuffer(_channels: number, length: number, rate: number) { return {duration: length / rate, getChannelData: () => new Float32Array(length)}; }
    createBufferSource() { const source = {onended: null as (() => void) | null, connect: vi.fn(), start: vi.fn(), stop: vi.fn()}; sources.push(source); return source; }
  });
  const h = handlers();
  const handle = await openOmniConversation({threadId: 't-1', agentId: 'd011'}, h, {sessionToken: 'tok', capture: async () => ({onFrame: vi.fn(), stop: vi.fn(), sourceSampleRate: 16000})});
  const audio = btoa(String.fromCharCode(...new Uint8Array(480)));
  for (let i = 0; i < 2; i++) FakeSocket.last!.emit('message', {data: JSON.stringify({type: 'assistant.audio', audio})});
  FakeSocket.last!.emit('message', {data: JSON.stringify({type: 'assistant.audio_done'})});
  expect(h.onAssistantAudio).toHaveBeenLastCalledWith(true);
  expect(sources[1]!.start).toHaveBeenCalledWith(0.03);
  sources[0]!.onended!();
  expect(h.onAssistantAudio).toHaveBeenLastCalledWith(true);
  sources[1]!.onended!();
  expect(h.onAssistantAudio).toHaveBeenLastCalledWith(false);
  await handle.stop();
});

it('ignores canceled response audio still in transit while accepting the next response', async () => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  const start = vi.fn();
  vi.stubGlobal('AudioContext', class {
    currentTime = 0; destination = {}; resume = vi.fn(); close = vi.fn();
    createBuffer() { return {duration: 0.01, getChannelData: () => new Float32Array(1)}; }
    createBufferSource() { return {connect: vi.fn(), start, stop: vi.fn()}; }
  });
  const h = handlers();
  const handle = await openOmniConversation({threadId:'t',agentId:'d011'}, h, {sessionToken:'tok', capture:async()=>({onFrame:vi.fn(),stop:vi.fn(),sourceSampleRate:16000})});
  const emitAudio = (responseId: string) => FakeSocket.last!.emit('message', {data:JSON.stringify({type:'assistant.audio', audio:'AAA=', responseId})});
  emitAudio('old');
  handle.cancelResponse();
  emitAudio('old');
  expect(start).toHaveBeenCalledTimes(1);
  expect(h.onAssistantAudio).toHaveBeenLastCalledWith(false);
  emitAudio('new');
  expect(start).toHaveBeenCalledTimes(2);
  expect(h.onAssistantAudio).toHaveBeenLastCalledWith(true);
  await handle.stop();
});
