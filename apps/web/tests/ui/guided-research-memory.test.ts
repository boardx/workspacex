// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { readResearchMemory, writeResearchMemory, getResearchMemoryScope, readResearchOnce } from "@/lib/guided-research-memory";
import { getStoredSessionToken } from "@/lib/api-client";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/api-client", () => ({ getStoredSessionToken: vi.fn() }));
beforeEach(() => { vi.mocked(getStoredSessionToken).mockReturnValue(null); readResearchMemory("s"); vi.mocked(getStoredSessionToken).mockReturnValue("account-a"); });
it("retains all steps across navigation and merges metadata without replacing runtime", () => {
  const runtime = runtimeFixture("outline");
  writeResearchMemory("s", { runtime }, "account-a");
  writeResearchMemory("s", { name: "研究一" }, "account-a");
  expect(readResearchMemory("s")).toMatchObject({ runtime, name: "研究一" });
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

it("deduplicates concurrent reads only for the same identity, research and baseline", async () => {
  let finish!: (value: string) => void;
  const read = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const baseline = {};
  const first = readResearchOnce("s", "runtime", "account-a", read, baseline);
  const second = readResearchOnce("s", "runtime", "account-a", read, baseline);
  expect(second).toBe(first); expect(read).toHaveBeenCalledTimes(1);
  finish("first"); await first;
  const later = readResearchOnce("s", "runtime", "account-a", read, baseline);
  expect(read).toHaveBeenCalledTimes(2); finish("later"); await later;
  const a = readResearchOnce("s", "runtime", "account-a", read, {});
  const finishA = finish;
  const b = readResearchOnce("other", "runtime", "account-a", read, baseline);
  const finishB = finish;
  vi.mocked(getStoredSessionToken).mockReturnValue("account-b");
  const c = readResearchOnce("s", "runtime", "account-b", read, baseline);
  expect(read).toHaveBeenCalledTimes(5);
  finishA("a"); finishB("b"); finish("c"); await Promise.all([a,b,c]);
});

it("clears research memory when the current organization changes with the same bearer", () => {
  localStorage.setItem("wsx.session", JSON.stringify({ currentOrgId: "org-one" }));
  const scope = getResearchMemoryScope();
  writeResearchMemory("s", { runtime: runtimeFixture("brief") }, scope);
  expect(readResearchMemory("s")?.runtime).toBeDefined();
  localStorage.setItem("wsx.session", JSON.stringify({ currentOrgId: "org-two" }));
  expect(readResearchMemory("s")).toBeUndefined();
  writeResearchMemory("s", { name: "late old organization" }, scope);
  expect(readResearchMemory("s")).toBeUndefined();
  localStorage.removeItem("wsx.session");
});
