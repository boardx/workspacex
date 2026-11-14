import { afterEach, expect, it, vi } from "vitest";
import { isAidtModuleEnabled, parseAidtModuleEnabled } from "@/lib/aidt-module-config";

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "false", "0", "TRUE", " true ", "enabled"])("keeps the module disabled for %s", value => {
  expect(parseAidtModuleEnabled(value)).toBe(false);
});
it.each(["1", "true"])("allows an explicit %s build-time opt-in", value => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", value);
  expect(isAidtModuleEnabled()).toBe(true);
});
it("does not infer Web access from a backend flag", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", undefined);
  vi.stubEnv("ENABLE_AIDT_MODULE", "true");
  expect(isAidtModuleEnabled()).toBe(false);
});
