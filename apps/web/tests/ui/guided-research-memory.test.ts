import { beforeEach, expect, it, vi } from "vitest";
import { readResearchMemory, writeResearchMemory } from "@/lib/guided-research-memory";
import { getStoredSessionToken } from "@/lib/api-client";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/api-client", () => ({ getStoredSessionToken: vi.fn() }));
beforeEach(() => { vi.mocked(getStoredSessionToken).mockReturnValue(null); readResearchMemory("s"); vi.mocked(getStoredSessionToken).mockReturnValue("account-a"); });
it("retains all steps across navigation and merges metadata without replacing runtime", () => {
  const runtime = runtimeFixture("outline");
  writeResearchMemory("s", { runtime }, "account-a");
  writeResearchMemory("s", { name: "研究一" }, "account-a");
  expect(readResearchMemory("s")).toEqual({ runtime, name: "研究一" });
});
it("clears state on account changes and rejects late responses from previous credentials", () => {
  writeResearchMemory("s", { runtime: runtimeFixture("outline") }, "account-a");
  vi.mocked(getStoredSessionToken).mockReturnValue("account-b");
  expect(readResearchMemory("s")).toBeUndefined();
  writeResearchMemory("s", { name: "late" }, "account-a");
  expect(readResearchMemory("s")).toBeUndefined();
  writeResearchMemory("s", { name: "current" }, "account-b");
  expect(readResearchMemory("s")?.name).toBe("current");
  vi.mocked(getStoredSessionToken).mockReturnValue(null);
  expect(readResearchMemory("s")).toBeUndefined();
});
it("bounds detached sessions while keeping the most recently updated session", () => {
  for (const id of ["1", "2", "3", "1", "4"]) writeResearchMemory(id, { name: id }, "account-a");
  expect(readResearchMemory("2")).toBeUndefined();
  expect(readResearchMemory("1")?.name).toBe("1");
});
