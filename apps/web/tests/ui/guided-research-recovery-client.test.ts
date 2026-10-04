import { expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import { getResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/api-client", async (original) => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: vi.fn() }));
it("forwards the recovery cancellation signal to the runtime HTTP request", async () => {
  const state = runtimeFixture("report");
  vi.mocked(apiRequest).mockResolvedValue(state);
  const controller = new AbortController();
  const received = await getResearchRuntime(state.sessionId, controller.signal);
  expect(received.sources).toEqual(state.sources);
  expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(state.sessionId), { method: "GET", signal: controller.signal });
});
