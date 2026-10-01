// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanupSeededOrganizations, trackSeededOrganization } from "./fixture-ownership";

vi.mock("pg", () => { throw new Error("The ownership registry must not load pg"); });
afterEach(() => cleanupSeededOrganizations());

it("empty cleanup is inert in jsdom without loading database modules", async () => {
  await expect(cleanupSeededOrganizations()).resolves.toBeUndefined();
});

it("cleans only registered owners once, including replacement registrations", async () => {
  const replaced = vi.fn(async () => {});
  const latest = vi.fn(async () => {});
  const foreign = vi.fn(async () => {});
  trackSeededOrganization("owned", replaced);
  trackSeededOrganization("owned", latest);
  await cleanupSeededOrganizations();
  await cleanupSeededOrganizations();
  expect(latest).toHaveBeenCalledOnce();
  expect(replaced).not.toHaveBeenCalled();
  expect(foreign).not.toHaveBeenCalled();
});

it("propagates a cleanup failure and retains ownership for retry", async () => {
  const remove = vi.fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("injected cleanup failure"))
    .mockResolvedValue(undefined);
  trackSeededOrganization("retry", remove);
  await expect(cleanupSeededOrganizations()).rejects.toThrow("injected cleanup failure");
  await cleanupSeededOrganizations();
  await cleanupSeededOrganizations();
  expect(remove).toHaveBeenCalledTimes(2);
});

it("does not forget a replacement registered while the prior cleanup is running", async () => {
  const next = vi.fn(async () => {});
  trackSeededOrganization("reseeded", async () => trackSeededOrganization("reseeded", next));
  await cleanupSeededOrganizations();
  expect(next).not.toHaveBeenCalled();
  await cleanupSeededOrganizations();
  expect(next).toHaveBeenCalledOnce();
});

it("retries only a rolled-back PostgreSQL deadlock and forgets ownership after success", async () => {
  const remove = vi.fn<() => Promise<void>>()
    .mockRejectedValueOnce(Object.assign(new Error("deadlock detected"), { code: "40P01" }))
    .mockResolvedValue(undefined);
  trackSeededOrganization("deadlock-once", remove);
  await cleanupSeededOrganizations();
  await cleanupSeededOrganizations();
  expect(remove).toHaveBeenCalledTimes(2);
});

it("fails closed after three deadlocks and retains ownership for a later cleanup", async () => {
  const failure = Object.assign(new Error("deadlock detected"), { code: "40P01" });
  const remove = vi.fn<() => Promise<void>>().mockRejectedValue(failure);
  trackSeededOrganization("deadlock-exhausted", remove);
  await expect(cleanupSeededOrganizations()).rejects.toBe(failure);
  expect(remove).toHaveBeenCalledTimes(3);
  remove.mockResolvedValue(undefined);
  await cleanupSeededOrganizations();
  await cleanupSeededOrganizations();
  expect(remove).toHaveBeenCalledTimes(4);
});

it("does not retry other PostgreSQL failures", async () => {
  const failure = Object.assign(new Error("permission denied"), { code: "42501" });
  const remove = vi.fn<() => Promise<void>>().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  trackSeededOrganization("denied", remove);
  await expect(cleanupSeededOrganizations()).rejects.toBe(failure);
  expect(remove).toHaveBeenCalledOnce();
  await cleanupSeededOrganizations();
});
