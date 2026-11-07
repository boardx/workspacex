import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { renderWelcomeCreditSchema } from "../../scripts/generate-welcome-credit-schema";
it("keeps the generated welcome schema aligned with closed contract vocabularies",()=>{
  expect(readFileSync(new URL("../../migrations/20261102000000_welcome_credit_periods.sql",import.meta.url),"utf8")).toBe(renderWelcomeCreditSchema());
});
