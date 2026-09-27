import { expect, it } from "vitest";
import { research } from "@repo/contracts";
import { prototypeRuntime } from "@/components/research-studio/research-prototype-fixture";

it("keeps the visual fixture within the production runtime contract", () => {
  expect(() => research.GuidedResearchRuntime.parse(prototypeRuntime())).not.toThrow();
});
