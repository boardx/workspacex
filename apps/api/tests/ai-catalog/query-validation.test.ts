import { expect, it } from "vitest";
import {
  AI_CATALOG_LIST_QUERY,
  AI_CATALOG_PUBLIC_QUERY,
} from "../../src/interface/controllers/ai-catalog-admin.controller";
import {
  ContractValidationError,
  ZodBodyPipe,
} from "../../src/interface/pipes/zod-body.pipe";
it("coerces bounded HTTP pagination through the canonical query contract", () => {
  expect(
    new ZodBodyPipe(AI_CATALOG_LIST_QUERY).transform({
      kind: "agent",
      limit: "25",
    }),
  ).toMatchObject({ kind: "agent", limit: 25 });
  expect(
    new ZodBodyPipe(AI_CATALOG_PUBLIC_QUERY).transform({ kind: "skill" }),
  ).toMatchObject({ kind: "skill", limit: 50 });
  for (const raw of [
    { kind: "unknown" },
    { kind: "agent", limit: "101" },
    { kind: "skill", limit: "NaN" },
    { kind: "skill", orgId: "forged" },
  ])
    expect(() =>
      new ZodBodyPipe(AI_CATALOG_PUBLIC_QUERY).transform(raw),
    ).toThrow(ContractValidationError);
});
