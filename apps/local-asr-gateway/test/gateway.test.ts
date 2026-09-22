/**
 * Protocol tests with the fake engine: exact frames, both turn-detection modes, the benign
 * empty-commit error, and format rejection. No model on disk needed.
 */
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { FakeEngine } from "../src/engine";
import { startGateway, type GatewayHandle } from "../src/gateway";

let handle: GatewayHandle | null = null;
afterEach(async () => { await handle?.close(); handle = null; });

function pcm(samples: number): string {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) buf.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2);
  return buf.toString("base64");
}

async function connect(url: string, model = "local-zipformer"): Promise<{ ws: WebSocket; frames: Record<string, unknown>[]; next: (type: string) => Promise<Record<string, unknown>> }> {
  const ws = new WebSocket(`${url}?model=${model}`, { headers: { Authorization: "bearer local", "OpenAI-Beta": "realtime=v1" } });
  const frames: Record<string, unknown>[] = [];
  const waiters: { type: string; resolve: (f: Record<string, unknown>) => void }[] = [];
  ws.on("message", (raw) => {
    const f = JSON.parse(String(raw)) as Record<string, unknown>;
    const i = waiters.findIndex((w) => w.type === f.type);
    if (i >= 0) { waiters.splice(i, 1)[0]!.resolve(f); return; }
    frames.push(f);
  });
  await new Promise<void>((r) => ws.once("open", () => r()));
  return {
    ws, frames,
    next: (type) => new Promise((resolve, reject) => {
      const seen = frames.find((f) => f.type === type);
      if (seen) { frames.splice(frames.indexOf(seen), 1); resolve(seen); return; }
      waiters.push({ type, resolve });
      setTimeout(() => reject(new Error(`no ${type} frame within 5s; got ${frames.map((f) => f.type).join(",")}`)), 5000);
    }),
  };
}

describe("local ASR gateway protocol", () => {
  it("server_vad: partials while audio flows, final on endpoint, final on commit", async () => {
    handle = await startGateway({ engine: new FakeEngine({ endpointAfterSamples: 4000 }), port: 0, tickMs: 20 });
    const c = await connect(handle.url);
    c.ws.send(JSON.stringify({ type: "session.update", session: { input_audio_format: "pcm", sample_rate: 16000, input_audio_transcription: { model: "local-zipformer" }, turn_detection: { type: "server_vad", silence_duration_ms: 800 } } }));
    const updated = await c.next("session.updated");
    expect((updated.session as { engine: string }).engine).toBe("fake");

    c.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(1000) }));
    const partial = await c.next("conversation.item.input_audio_transcription.text");
    expect(partial.text).toBe("heard 1000");
    expect(partial.stash).toBe(" @16000");

    c.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(3000) }));
    const final1 = await c.next("conversation.item.input_audio_transcription.completed");
    expect(final1.transcript).toBe("final 4000 of 4000");
    expect(String(final1.item_id)).toMatch(/^item_/);
    expect(String(final1.event_id)).toMatch(/^event_/);

    c.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(500) }));
    c.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    const final2 = await c.next("conversation.item.input_audio_transcription.completed");
    expect(final2.transcript).toBe("final 500 of 4500");

    // finish-shaped commit with nothing buffered: DashScope's benign error, byte-compatible
    c.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    const err = await c.next("error");
    expect(String((err.error as { message: string }).message)).toMatch(/buffer is too small/i);
    c.ws.close();
  });

  it("manual: only commit closes segments, session.finish answers session.finished then closes", async () => {
    handle = await startGateway({ engine: new FakeEngine({ endpointAfterSamples: 10 }), port: 0, tickMs: 20 });
    const c = await connect(handle.url);
    c.ws.send(JSON.stringify({ type: "session.update", event_id: "e1", session: { input_audio_format: "pcm", sample_rate: 16000, input_audio_transcription: { model: "m" }, turn_detection: null } }));
    await c.next("session.updated");
    c.ws.send(JSON.stringify({ type: "input_audio_buffer.append", event_id: "e2", audio: pcm(2000) }));
    await c.next("conversation.item.input_audio_transcription.text");
    await new Promise((r) => setTimeout(r, 80));
    expect(c.frames.some((f) => f.type === "conversation.item.input_audio_transcription.completed")).toBe(false); // endpoint ignored in manual mode
    c.ws.send(JSON.stringify({ type: "input_audio_buffer.commit", event_id: "e3" }));
    const final = await c.next("conversation.item.input_audio_transcription.completed");
    expect(final.transcript).toBe("final 2000 of 2000");
    const closed = new Promise<number>((r) => c.ws.once("close", (code) => r(code)));
    c.ws.send(JSON.stringify({ type: "session.finish", event_id: "e4" }));
    await c.next("session.finished");
    expect(await closed).toBe(1000);
  });

  it("rejects non-pcm formats and frames before session.update", async () => {
    handle = await startGateway({ engine: new FakeEngine(), port: 0 });
    const c = await connect(handle.url);
    c.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(10) }));
    expect(String(((await c.next("error")).error as { message: string }).message)).toMatch(/session.update/);
    c.ws.send(JSON.stringify({ type: "session.update", session: { input_audio_format: "opus", sample_rate: 48000 } }));
    expect(String(((await c.next("error")).error as { message: string }).message)).toMatch(/format/);
    c.ws.close();
  });

  it("serves /healthz over plain HTTP", async () => {
    handle = await startGateway({ engine: new FakeEngine(), port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, engine: "fake" });
  });
});
