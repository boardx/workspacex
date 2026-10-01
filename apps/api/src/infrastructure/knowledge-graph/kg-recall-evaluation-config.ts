import type { RecallEvaluationMode } from "../../domain/knowledge-graph/recall";

/** Ablation is available only in a deliberately isolated acceptance process. */
export function readKgRecallEvaluationMode(env: Readonly<Record<string, string | undefined>> = process.env): RecallEvaluationMode | undefined {
  const mode = env.KG_EVAL_RECALL_MODE;
  if (mode === undefined || mode === "") return undefined;
  if (mode !== "hybrid" && mode !== "vector_only") throw new Error("Invalid KG_EVAL_RECALL_MODE");
  if (env.KG_EVAL_FIXTURE !== "1" || !env.PGDATABASE?.startsWith("wsx_kg_") || env.WORKSPACEX_DB !== env.PGDATABASE) {
    throw new Error("Recall ablation requires an isolated wsx_kg_ acceptance database and KG_EVAL_FIXTURE=1");
  }
  return mode;
}
