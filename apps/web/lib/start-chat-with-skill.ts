/**
 * 从首页「组织推荐」点一个 Skill → 新建对话并自动挂载该 Skill。
 *
 * 之前的写法把 Skill 卡片链到后台 `/skill` 目录页，与用户意图（「用这个 Skill 开始工作」）
 * 不符。对话里 Skill 是**按线程**挂载的（`POST /threads/:threadId/skill-mounts`），所以
 * 必须先有线程：建个人线程 → 读挂载列表拿乐观锁版本号 → 挂载 → 由调用方跳到该线程。
 * 这样第一轮消息发出前 Skill 就已经在线程上，不是发完再补挂。
 *
 * 挂载被服务端拒绝（角色/Skill 未启用等）时**仍返回已建好的线程**并带上失败原因，
 * 让用户落在一个空对话里、看见原因，而不是点了没反应；不在客户端复述权限规则。
 */
import { createPersonalThread } from "./live-chat";
import { listThreadMounts, mountSkills } from "./live-skill-mount";

export interface StartChatWithSkillResult {
  readonly threadId: string;
  readonly mounted: boolean;
  /** 挂载失败时的服务端 reasonCode（无则 null）。 */
  readonly failureReason: string | null;
}

export async function startChatWithSkill(skill: { readonly skillId: string; readonly name: string }): Promise<StartChatWithSkillResult> {
  const created = await createPersonalThread(skill.name);
  const threadId = created.threadId;
  try {
    const { version } = await listThreadMounts(threadId, undefined);
    await mountSkills(threadId, undefined, { skillIds: [skill.skillId], expectedVersion: version });
    return { threadId, mounted: true, failureReason: null };
  } catch (err) {
    const reason =
      typeof err === "object" && err !== null && "reasonCode" in err
        ? String((err as { reasonCode: unknown }).reasonCode ?? "")
        : "";
    return { threadId, mounted: false, failureReason: reason.length > 0 ? reason : "MOUNT_FAILED" };
  }
}
