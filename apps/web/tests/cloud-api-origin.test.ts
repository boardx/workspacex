import { afterEach, expect, it, vi } from "vitest";
import { apiBaseUrl, apiUrl, apiWebSocketUrl } from "../lib/api-client";
import { buildAguiUrl } from "../lib/copilotkit-v2-agui-url";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each(["https://starter.example", "https://production.example"])("uses the current %s browser origin without rebuilding", origin => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "/api");
  vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  vi.stubEnv("NEXT_PUBLIC_API_WS_URL", undefined);
  vi.stubGlobal("window", { location: { origin } });
  expect(apiUrl("/auth/login")).toBe(`${origin}/api/auth/login`);
  expect(apiWebSocketUrl("/asr/stream?projectId=p")).toBe(`${origin.replace("https:", "wss:")}/api/asr/stream?projectId=p`);
});
it("uses the private service for SSR and Copilot without the public /api prefix", () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "/api");
  vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  vi.stubEnv("API_INTERNAL_URL", "http://api:3200");
  vi.stubGlobal("window", undefined);
  expect(apiUrl("/auth/login")).toBe("http://api:3200/auth/login");
  expect(buildAguiUrl("/copilotkit/agui", { internalPort: undefined, apiBaseUrl: apiBaseUrl(), pathPrefix: undefined })).toBe("http://api:3200/copilotkit/agui");
});
it("fails closed on missing private origin and protocol-relative public URLs", () => {
  vi.stubGlobal("window", undefined);
  vi.stubEnv("NEXT_PUBLIC_API_URL", "/api");
  vi.stubEnv("API_INTERNAL_URL", undefined);
  expect(() => apiBaseUrl()).toThrow("API_INTERNAL_URL");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "//other.example");
  expect(() => apiBaseUrl()).toThrow("same-origin");
});
it("preserves absolute HTTP base paths and explicit legacy WebSocket origin", () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://legacy.example/api");
  vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  vi.stubEnv("NEXT_PUBLIC_API_WS_URL", "https://socket.example");
  expect(apiUrl("/auth/login")).toBe("https://legacy.example/api/auth/login");
  expect(apiWebSocketUrl("/asr/stream")).toBe("wss://socket.example/asr/stream");
});
