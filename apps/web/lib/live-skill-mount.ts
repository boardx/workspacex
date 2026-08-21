/**
 * #467 / #509 —— 对话内临时挂载 skill（F65）的前端薄封装。
 *
 * 后端边界是 `apps/api/src/interface/controllers/skill-mount.controller.ts`，
 * 三条路径都落到真实的 `thread_skill_mounts`（迁移
 * `20260805170000_i467_thread_skill_mounts.sql`），不是 fixture、不是 mock。
 *
 * ## 这个文件不做判断
 *
 * 没有「我是不是引导师」的分支。谁能挂载是服务端的裁决
 * （`application/skill/mount-skill-to-thread.ts` 的 `isSelfMountAllowed`），
 * 越权尝试在那边被拒并**写安全审计**。在客户端复述一份角色规则，等于给同一条规则
 * 留了第二份会漂移的副本，而且会让「界面藏了入口」被误当成「权限生效了」。
 *
 * ## 形状与路径全部来自 `@repo/contracts`
 *
 * ⚠ `expectedVersion` 来自**读端口**（`listThreadDeviations` 的 `version`
 *   —— 见下面 `readMounts` 的说明）。调用方**不得**用「读不到就传空串」兜底：
 *   乐观锁的意义就是拒绝盲写，读不到版本号时不提交（同 `live-chat.ts`
 *   `updateAgentRoster` 那条纪律）。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ThreadSkillMount = z.infer<typeof skills.ThreadSkillMount>;
export type MountSkillToThreadOut = z.infer<typeof skills.operations.mountSkillToThread.out>;
export type UnmountSkillFromThreadOut = z.infer<
  typeof skills.operations.unmountSkillFromThread.out
>;
export type ListThreadDeviationsOut = z.infer<typeof skills.operations.listThreadDeviations.out>;

function threadPath(path: string, threadId: string): string {
  return path.replace(":threadId", encodeURIComponent(threadId));
}

/**
 * 读本线程当前挂着什么。
 *
 * ⚠ 契约里没有第二条「列出本线程挂载」的操作，`listThreadDeviations.out.temporary`
 *   就是那份列表——所以这条读**同时**是复盘视图和界面的状态来源，不是两份数据。
 */
export async function listThreadMounts(
  threadId: string,
  /** ⚠ 可选：个人对话没有项目。#1693 起服务端不再把它当授权输入（授权从线程反推）。 */
  projectId: string | undefined,
  sessionToken?: string,
): Promise<ListThreadDeviationsOut> {
  return apiRequest<ListThreadDeviationsOut>(
    threadPath(skills.operations.listThreadDeviations.path, threadId),
    { method: "GET", query: projectId === undefined ? {} : { projectId }, sessionToken },
  );
}

/**
 * `projectId` 走 **query**、其余走 **body** —— controller 把它读作 `@Query`
 * （`skill-mount.controller.ts` 的 `requireProjectId`），而 body 过契约的
 * `.strict()`，把 `projectId` 塞进 body 会被拒。与 `live-chat.ts` 的
 * `updateAgentRoster` 同一个落法，不是本函数特有的怪癖。
 */
export async function mountSkills(
  threadId: string,
  /** ⚠ 可选：个人对话没有项目。#1693 起服务端不再把它当授权输入（授权从线程反推）。 */
  projectId: string | undefined,
  input: { skillIds: readonly string[]; expectedVersion: string },
  sessionToken?: string,
): Promise<MountSkillToThreadOut> {
  return apiRequest<MountSkillToThreadOut>(
    threadPath(skills.operations.mountSkillToThread.path, threadId),
    {
      method: "POST",
      query: projectId === undefined ? {} : { projectId },
      body: { threadId, skillIds: [...input.skillIds], expectedVersion: input.expectedVersion },
      sessionToken,
    },
  );
}

export async function unmountSkill(
  threadId: string,
  mountId: string,
  /** ⚠ 可选：个人对话没有项目。与本文件另外两个函数同一条理由。 */
  projectId: string | undefined,
  sessionToken?: string,
): Promise<UnmountSkillFromThreadOut> {
  return apiRequest<UnmountSkillFromThreadOut>(
    threadPath(skills.operations.unmountSkillFromThread.path, threadId).replace(
      ":mountId",
      encodeURIComponent(mountId),
    ),
    { method: "DELETE", query: projectId === undefined ? {} : { projectId }, sessionToken },
  );
}
