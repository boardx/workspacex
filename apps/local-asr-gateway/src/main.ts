/**
 * Process entry. Env:
 *   LOCAL_ASR_PORT       (default 3320)
 *   LOCAL_ASR_HOST       (default 127.0.0.1 -- keep it loopback)
 *   LOCAL_ASR_ENGINE     sherpa | fake      (default sherpa)
 *   LOCAL_ASR_MODEL_DIR  directory with encoder/decoder/joiner .onnx + tokens.txt (sherpa)
 *   LOCAL_ASR_THREADS    (default 2)
 */
import { FakeEngine, type Engine } from "./engine";
import { startGateway } from "./gateway";
import { SherpaEngine } from "./sherpa-engine";

const engineName = process.env.LOCAL_ASR_ENGINE ?? "sherpa";
let engine: Engine;
if (engineName === "fake") {
  engine = new FakeEngine({ endpointAfterSamples: 16_000 });
} else if (engineName === "sherpa") {
  const modelDir = process.env.LOCAL_ASR_MODEL_DIR;
  if (!modelDir) throw new Error("LOCAL_ASR_MODEL_DIR is required for LOCAL_ASR_ENGINE=sherpa");
  engine = new SherpaEngine({ modelDir, numThreads: Number(process.env.LOCAL_ASR_THREADS ?? "2") });
} else {
  throw new Error(`unknown LOCAL_ASR_ENGINE ${engineName}`);
}

const handle = await startGateway({
  engine,
  host: process.env.LOCAL_ASR_HOST ?? "127.0.0.1",
  port: Number(process.env.LOCAL_ASR_PORT ?? "3320"),
  log: (l) => process.stdout.write(`${l}\n`),
});
const stop = async (): Promise<void> => { await handle.close(); engine.close(); process.exit(0); };
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
