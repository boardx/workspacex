import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { ConfiguredRealtimeAsrProvider } from "../../src/infrastructure/recording/configured-realtime-asr-provider";

const require = createRequire(import.meta.url);
let child: ChildProcess | undefined;
afterEach(async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise<void>(resolve => child!.once("exit", () => resolve()));
  child.kill();
  await stopped;
});

it.each([0, 3200])("the actual fullstack loopback flushes recording audio and acknowledges finish (%s bytes)", async bytes => {
  const reserve = createServer();
  await new Promise<void>(resolve => reserve.listen(0, "127.0.0.1", resolve));
  const address = reserve.address();
  if (!address || typeof address === "string") throw new Error("port reservation failed");
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  child = spawn(process.execPath, [require.resolve("tsx/cli"), "scripts/loopback-asr-provider.ts"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, LOOPBACK_ASR_PROVIDER_PORT: String(address.port), LOOPBACK_ASR_TRANSCRIPT_PREFIX: "[recording-test]" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("loopback startup timeout")), 5000);
    child!.on("error", reject);
    child!.on("exit", () => { clearTimeout(timeout); reject(new Error("loopback exited")); });
    child!.stdout!.on("data", data => {
      if (String(data).includes("loopback asr provider listening")) { clearTimeout(timeout); resolve(); }
    });
  });
  const finals: string[] = []; const errors: string[] = [];
  const session = await new ConfiguredRealtimeAsrProvider({ provider: "dashscope", baseUrl: `ws://127.0.0.1:${address.port}`,
    apiKey: "test-only", model: "test-model" }).open({ onPartial: () => undefined,
    onFinal: event => finals.push(event.text), onError: reason => errors.push(reason), onClosed: () => undefined },
  { sampleRate: 16000, channels: 1, encoding: "pcm16le" }, { turnDetection: "recording" });
  try {
    if (bytes) session.pushAudio(new Uint8Array(bytes));
    await session.finish();
    expect(errors).toEqual([]);
    expect(finals).toEqual(bytes ? [`[recording-test] ${bytes}`] : []);
  } finally { session.abort(); }
});
