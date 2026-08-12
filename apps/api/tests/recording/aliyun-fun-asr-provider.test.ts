import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { AliyunFunAsrProvider, readAliyunFunAsrConfig } from "../../src/infrastructure/recording/aliyun-fun-asr-provider";

let server: Server | undefined;
let wss: WebSocketServer | undefined;

afterEach(() => new Promise<void>((resolve) => {
  wss?.close();
  server?.close(() => resolve());
  if (!server) resolve();
}));

describe("readAliyunFunAsrConfig", () => {
  it("uses the public Beijing endpoint when only the API key is configured", () => {
    expect(readAliyunFunAsrConfig({ DASHSCOPE_API_KEY: "test-key" })).toEqual({
      apiKey: "test-key",
      workspaceId: undefined,
      region: "cn-beijing",
      model: "fun-asr-realtime",
      endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    });
  });

  it("prefers the workspace-specific endpoint when a workspace ID is configured", () => {
    expect(readAliyunFunAsrConfig({
      DASHSCOPE_API_KEY: "test-key",
      ALIYUN_ASR_WORKSPACE_ID: "workspace-1",
    })).toEqual(expect.objectContaining({
      workspaceId: "workspace-1",
      endpoint: "wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
    }));
  });

  it("uses bearer/workspace headers and sends the official run-task frame", async () => {
    server = createServer();
    wss = new WebSocketServer({ server });
    let authorization = "";
    let workspace = "";
    const frames: string[] = [];
    wss.on("connection", (ws, request) => {
      authorization = String(request.headers.authorization);
      workspace = String(request.headers["x-dashscope-workspace"]);
      ws.on("message", (raw, isBinary) => { if (!isBinary) frames.push(String(raw)); });
    });
    const port = await new Promise<number>((resolve) => server!.listen(0, "127.0.0.1", () => resolve((server!.address() as AddressInfo).port)));
    const provider = new AliyunFunAsrProvider({
      apiKey: "key", workspaceId: "workspace", region: "cn-beijing",
      model: "fun-asr-realtime", endpoint: `ws://127.0.0.1:${port}`,
    });
    const session = await provider.open({ onInterim: () => undefined, onFinal: () => undefined, onError: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(authorization).toBe("Bearer key");
    expect(workspace).toBe("workspace");
    expect(JSON.parse(frames[0]!).payload).toMatchObject({
      task_group: "audio", task: "asr", function: "recognition", model: "fun-asr-realtime",
      parameters: { format: "pcm", sample_rate: 16000 },
    });
    session.abort();
  });
});
