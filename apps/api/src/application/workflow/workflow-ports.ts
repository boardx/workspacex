/**
 * Workflow Runtime 应用层端口（WF01）。实现由 infrastructure/workflow 提供（PG）；
 * 本文件只声明依赖形状，application 不 import infrastructure。
 */
import type { PinnedSkillVersion, WorkflowDefinitionVersionView, WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import type { WorkflowGraphCatalog } from "../../domain/workflow/definition-version";

export type { WorkflowGraphCatalog };

export interface WorkflowDefinitionRepository {
  /** 组织是否可见该 key 的 Definition（不可见 = workflow_not_found）。 */
  definitionExists(orgId: string, key: string): Promise<boolean>;
  findVersion(orgId: string, key: string, version: number): Promise<WorkflowDefinitionVersionView | null>;
  /** 最新 published 版本号；无则 null。 */
  latestPublishedVersion(orgId: string, key: string): Promise<number | null>;
  /** 写入一条 published 版本；实现必须拒绝覆盖已存在的 (org,key,version)（I-2）。 */
  insertPublished(orgId: string, view: WorkflowDefinitionVersionView): Promise<void>;
}

/** 解析 Skill 引用为已发布版本（按组织可见性）；不可解析返回 null。 */
export interface SkillVersionResolverPort {
  resolve(orgId: string, stableId: string, versionRange: string): Promise<string | null>;
}

export interface PinnedWorkflowInstance {
  instanceId: string;
  orgId: string;
  workflowKey: string;
  definitionVersion: number;
  graphRef: string;
  pinnedSkills: readonly PinnedSkillVersion[];
  agentId: string;
  agentVersionId: string;
  initiatorUserId: string;
  triggerKind: "manual" | "schedule" | "webhook";
  status: WorkflowInstanceStatus;
  stateVersion: number;
}

export interface WorkflowInstanceRepository {
  /** 创建后 definitionVersion / pinnedSkills 不再改变（I-4）；实现不得提供修改它们的路径。 */
  create(instance: PinnedWorkflowInstance): Promise<void>;
  find(orgId: string, instanceId: string): Promise<PinnedWorkflowInstance | null>;
}

/** 调用者身份（由 interface 层从会话解析后传入；application 不自己读会话）。 */
export interface WorkflowActor {
  userId: string;
  orgRole: "admin" | "member";
}

export interface WorkflowClock {
  nowIso(): string;
}
