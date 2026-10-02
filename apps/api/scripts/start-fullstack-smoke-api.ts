/** Test-only composition: real Nest/PG, explicitly injected localhost voice supplier.
 * Production src/main.ts never reads these test endpoints or selects a loopback.
 */
import { createApp, attachStreamingSurfaces } from "../src/main";
import { readRealtimeModelConfig } from "../src/interface/ws/realtime-digital-human.gateway";

const apiPort = Number(process.env.WORKSPACEX_API_PORT);
const supplierPort = Number(process.env.WORKSPACEX_ASR_PROVIDER_PORT);
for (const port of [apiPort, supplierPort]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("isolated fullstack ports are required");
}
const shared = readRealtimeModelConfig();
if (!shared.apiKey) throw new Error("fullstack shared model test credential is required");
const app = await createApp();
app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
await app.listen(apiPort, "127.0.0.1");
attachStreamingSurfaces(app, {
  realtimeConfig: { ...shared, baseUrl: `ws://127.0.0.1:${supplierPort}/omni-realtime` },
});
process.stdout.write(`fullstack test API listening on ${apiPort}; voice supplier LOCAL_PROTOCOL\n`);
