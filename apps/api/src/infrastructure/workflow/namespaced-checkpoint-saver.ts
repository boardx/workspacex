/**
 * WF02 —— 把一个 BaseCheckpointSaver 的所有持久化操作钉到固定 `checkpoint_ns`（= 图的 `key:version`，I-9）。
 *
 * LangGraph 为子图保留非空 namespace，并在调用 saver 前清空根图的 namespace；所以运行时看到的根 namespace
 * 保持为空，只在落库那一侧换成固定值。与 interview 目录里的 FixedNamespaceCheckpointSaver 同语义——
 * workflow 运行时不得反向 import interview（R3-12），WF07 迁移引导式研究后那份由其所有者删除。
 */
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";

function stored(config: RunnableConfig, ns: string): RunnableConfig {
  return { ...config, configurable: { ...config.configurable, checkpoint_ns: ns } };
}

function runtime(config: RunnableConfig): RunnableConfig {
  return { ...config, configurable: { ...config.configurable, checkpoint_ns: "" } };
}

function toRuntime(tuple: CheckpointTuple): CheckpointTuple {
  return { ...tuple, config: runtime(tuple.config), parentConfig: tuple.parentConfig ? runtime(tuple.parentConfig) : undefined };
}

export class NamespacedCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    readonly delegate: BaseCheckpointSaver,
    readonly checkpointNamespace: string,
  ) {
    super(delegate.serde);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const tuple = await this.delegate.getTuple(stored(config, this.checkpointNamespace));
    return tuple ? toRuntime(tuple) : undefined;
  }

  async *list(config: RunnableConfig, options?: Parameters<BaseCheckpointSaver["list"]>[1]): AsyncGenerator<CheckpointTuple> {
    const opts = options?.before ? { ...options, before: stored(options.before, this.checkpointNamespace) } : options;
    for await (const tuple of this.delegate.list(stored(config, this.checkpointNamespace), opts)) yield toRuntime(tuple);
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: Parameters<BaseCheckpointSaver["put"]>[3],
  ): Promise<RunnableConfig> {
    return runtime(await this.delegate.put(stored(config, this.checkpointNamespace), checkpoint, metadata, newVersions));
  }

  async putWrites(config: RunnableConfig, writes: Parameters<BaseCheckpointSaver["putWrites"]>[1], taskId: string): Promise<void> {
    await this.delegate.putWrites(stored(config, this.checkpointNamespace), writes, taskId);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.delegate.deleteThread(threadId);
  }
}
