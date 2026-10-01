/**
 * WF02 —— Workflow 运行时**唯一**的 checkpointer 工厂（ADR-118「后果」；domain I-9）。
 *
 * - schema 固定 `langgraph_workflow`（DDL 在迁移 20260929020000，运行期不需要 schema owner 权限，不调 setup()）；
 * - `checkpoint_ns = key:version`（图工厂注册键，WorkflowGraphRef 校验）；
 * - `thread_id = instanceId`；
 * - 共享连接池：调用方传入进程里那一个 pg.Pool，工厂只建**一个** PostgresSaver，所有 graphRef 共用它。
 *
 * `new PostgresSaver` 在 application|infrastructure 下只允许出现在本文件（tests/workflow/checkpointer-factory.test.ts 门控）。
 */
import type { RunnableConfig } from "@langchain/core/runnables";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { WorkflowGraphRef } from "@repo/contracts/workflow-runtime";
import type pg from "pg";
import { NamespacedCheckpointSaver } from "./namespaced-checkpoint-saver";

export const WORKFLOW_CHECKPOINT_SCHEMA = "langgraph_workflow";

export interface WorkflowCheckpointerFactory {
  /** 按冻结版本的图工厂键取 saver；同一 graphRef 返回同一实例。 */
  saverFor(graphRef: string): NamespacedCheckpointSaver;
  /** 运行某实例时交给 LangGraph 的 config（thread_id = instanceId）。 */
  configFor(instanceId: string): RunnableConfig;
}

export function createWorkflowCheckpointerFactory(pool: pg.Pool): WorkflowCheckpointerFactory {
  const shared = new PostgresSaver(pool, undefined, { schema: WORKFLOW_CHECKPOINT_SCHEMA });
  const byRef = new Map<string, NamespacedCheckpointSaver>();
  return {
    saverFor(graphRef) {
      const ref = WorkflowGraphRef.parse(graphRef);
      let saver = byRef.get(ref);
      if (!saver) {
        saver = new NamespacedCheckpointSaver(shared, ref);
        byRef.set(ref, saver);
      }
      return saver;
    },
    configFor(instanceId) {
      if (instanceId.length === 0) throw new Error("workflow thread_id (instanceId) must be non-empty");
      return { configurable: { thread_id: instanceId } };
    },
  };
}
