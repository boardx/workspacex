import { afterEach, expect, it, vi } from "vitest";
import { isAidtModuleEnabled, parseAidtModuleEnabled } from "@/lib/aidt-module-config";

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "false", "0", "TRUE", " true ", "enabled"])("keeps AIDT available for %s", value => {
  expect(parseAidtModuleEnabled(value)).toBe(true);
});
it.each(["1", "true"])("remains available with legacy flag %s", value => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", value);
  expect(isAidtModuleEnabled()).toBe(true);
});
it("does not require either deployment flag", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", undefined);
  vi.stubEnv("ENABLE_AIDT_MODULE", "true");
  expect(isAidtModuleEnabled()).toBe(true);
});
