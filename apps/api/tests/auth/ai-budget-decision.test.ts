import { describe, expect, it } from "vitest";
import { decideAiAdmission, priceAiTokens, type AiBudgetState } from "../../src/domain/agent-run/ai-budget";
const budget: AiBudgetState = { plan: "ordinary", tokenLimit: 100n, costLimitMicros: 1_000n,
 usedTokens: 10n, heldTokens: 30n, usedCostMicros: 100n, heldCostMicros: 200n };
describe("AI budget arithmetic (not runtime activation)", () => {
 it("fails closed for each missing policy instead of guessing", () => {
  expect(decideAiAdmission({...budget,plan:null},1n,1n)).toBe("PLAN_UNCONFIGURED");
  expect(decideAiAdmission({...budget,tokenLimit:null},1n,1n)).toBe("TOKEN_LIMIT_UNCONFIGURED");
  expect(decideAiAdmission({...budget,costLimitMicros:null},1n,1n)).toBe("COST_LIMIT_UNCONFIGURED");
 });
 it("includes concurrent holds and allows only the exact finite boundary", () => {
  expect(decideAiAdmission(budget,60n,700n)).toBe("allowed");
  expect(decideAiAdmission(budget,61n,700n)).toBe("TOKEN_LIMIT_REACHED");
  expect(decideAiAdmission(budget,60n,701n)).toBe("COST_LIMIT_REACHED");
 });
 it("enterprise skips only product token quota", () => {
  expect(decideAiAdmission({...budget,plan:"enterprise",tokenLimit:null},1_000_000n,700n)).toBe("allowed");
  expect(decideAiAdmission({...budget,plan:"enterprise",tokenLimit:null},1n,701n)).toBe("COST_LIMIT_REACHED");
 });
 it("prices input/output once, treats cache/reasoning as subsets and rounds conservatively", () => {
  const price={version:"explicit-price-v1",currency:"CNY",inputMicrosPerMillion:2_000_000n,
   outputMicrosPerMillion:6_000_000n,cachedInputMicrosPerMillion:1_000_000n};
  expect(priceAiTokens(price,{input:100n,output:50n,cachedInput:20n,reasoningOutput:10n})).toBe(480n);
  expect(priceAiTokens({...price,inputMicrosPerMillion:1n},{input:1n,output:0n})).toBe(1n);
 });
 it("rejects unknown cached prices and impossible subsets", () => {
  const price={version:"v1",currency:"CNY",inputMicrosPerMillion:1n,outputMicrosPerMillion:1n};
  expect(()=>priceAiTokens(price,{input:1n,output:1n,cachedInput:1n})).toThrow("AI_CACHE_PRICE_UNCONFIGURED");
  expect(()=>priceAiTokens(price,{input:1n,output:1n,reasoningOutput:2n})).toThrow("INVALID_AI_PRICE_OR_USAGE");
 });
});
