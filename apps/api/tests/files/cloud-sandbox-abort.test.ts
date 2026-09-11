import { createServer } from "node:http";
import { expect, it } from "vitest";
import { HttpSkillSandbox } from "../../src/infrastructure/skill/http-skill-sandbox";

it("cancels an in-flight sandbox transport using the provision signal", async () => {
  let received!: () => void;
  const arrived = new Promise<void>(resolve => { received = resolve; });
  const server = createServer((_request, _response) => received());
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  const controller = new AbortController();
  const sandbox = new HttpSkillSandbox({ baseUrl: `http://127.0.0.1:${address.port}`, requestTimeoutMs: 10000 });
  try {
    const result = sandbox.run({ script: "process.stdout.write('4')", timeoutMs: 2000, signal: controller.signal });
    const rejection = expect(result).rejects.toThrow();
    await arrived; controller.abort(); await rejection;
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it("does not contact a sandbox for an already cancelled action", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(new HttpSkillSandbox({}).run({ script: "", timeoutMs: 1, signal: controller.signal })).rejects.toThrow();
});
