import { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import type { PgConfig } from "../db/pg-config";
import { withCheckpointNamespace } from "../interview/workflow/langgraph-digital-interview-runtime";

const CHECKPOINT_NS = "guided-research:v1";

export function createGuidedResearchCheckpointer(config: PgConfig): BaseCheckpointSaver {
  const saver = new PostgresSaver(
    new pg.Pool({ ...config, max: 5 }), undefined, { schema: "langgraph_interview" },
  );
  return withCheckpointNamespace(saver, CHECKPOINT_NS);
}
