import { expect, it } from "vitest";
import { readKgRecallEvaluationMode } from "../../src/infrastructure/knowledge-graph/kg-recall-evaluation-config";

it("消融配置不能在普通或生产数据库环境启用", () => {
  expect(readKgRecallEvaluationMode({})).toBeUndefined();
  expect(() => readKgRecallEvaluationMode({ KG_EVAL_RECALL_MODE: "vector_only", PGDATABASE: "production", WORKSPACEX_DB: "production", KG_EVAL_FIXTURE: "1" })).toThrow("isolated");
  expect(() => readKgRecallEvaluationMode({ KG_EVAL_RECALL_MODE: "vector_only", PGDATABASE: "wsx_kg_test", WORKSPACEX_DB: "wsx_kg_test" })).toThrow("isolated");
  expect(() => readKgRecallEvaluationMode({ KG_EVAL_RECALL_MODE: "invalid" })).toThrow("Invalid");
  expect(readKgRecallEvaluationMode({ KG_EVAL_RECALL_MODE: "vector_only", PGDATABASE: "wsx_kg_test", WORKSPACEX_DB: "wsx_kg_test", KG_EVAL_FIXTURE: "1" })).toBe("vector_only");
});
