/**
 * 谁能读一个访谈对象 —— 洋葱最内层（F97，uc-6-7 R5）。
 *
 * R5 的五档角色矩阵里，唯一一条能在**不依赖 F98/F87**的情况下今天就判定的规则是
 * 「创建者恒可读」+「本组所属项目的成员可读，但观察者不可读对象表」——
 * 其余（组员不可读联系方式、研究员按被指派场次读、管理员访问写审计）依赖
 * 联系方式遮盖（F98）与访谈指派（F84/F99），本文件不提前实现那几条,
 * 只钉死「能不能看见这一行本身」这条最基础的规则。
 *
 * 与 `domain/interview/scope.ts` 同一手法：纯函数先判定，仓储层的 SQL 谓词
 * 是第二次表达，两者必须同义。
 */

/** 判定所需的最小事实：这一行属于哪个组、谁创建的。 */
export interface SubjectVisibilityFacts {
  readonly groupId: string | null;
  readonly createdBy: string;
}

export interface SubjectViewerFacts {
  readonly userId: string;
  /**
   * 看的人在「这一行所属的组所在的那个项目」里的角色；不是该项目成员则为 `null`。
   * 未归组的对象（`groupId === null`）不需要这个字段——见 `canReadSubject`。
   */
  readonly projectRole: "facilitator" | "groupLead" | "member" | "observer" | null;
}

/**
 * ⚠ **观察者不可读对象表**（R5 原文）——即便是该项目的正式成员，
 * `projectRole === "observer"` 也必须被拒。这是本函数存在的唯一理由：
 * 一条「项目成员即可读」的规则会把这句话漏掉。
 */
export function canReadSubject(s: SubjectVisibilityFacts, viewer: SubjectViewerFacts): boolean {
  if (s.createdBy === viewer.userId) return true;
  if (s.groupId === null) return false; // A1：未归组时唯一的可见性来源是创建者
  return viewer.projectRole !== null && viewer.projectRole !== "observer";
}

/**
 * 谁能看联系方式明文 —— R5 比 `canReadSubject` 窄得多的一道单独的门（F98，AC7）。
 *
 * 能读对象行（含掩码）≠ 能看明文：R5 逐字「组员…**不可读联系方式**」——即便组员是
 * 该项目的正式成员、`canReadSubject` 对他返回 `true`，明文这里也必须拒绝。
 * 所以这不是 `canReadSubject` 的一个特例，是需要单独调用的第二道判定。
 *
 * ⚠ **agent 主体一律拒绝，且不是权限配置能打开的一档**（O-39 / D-27）——
 * `viewer.actorKind === "agent"` 时函数直接返回 `false`，不看角色。
 *
 * R5 还给了「研究员：在访谈侧可读被指派给自己那场的对象」一档，但那依赖访谈指派
 * （F84/F99 尚未落地的会话级归属），本函数与 `canReadSubject` 同一立场——只钉死
 * 今天就能不依赖那条链路判定的规则（创建者 / 组长 / 引导师-项目负责人），
 * 研究员按会话指派读取留作已知缺口，不在这里假装实现。
 */
export interface ContactRevealViewer extends SubjectViewerFacts {
  readonly actorKind: "human" | "agent";
}

export function canRevealContact(s: SubjectVisibilityFacts, viewer: ContactRevealViewer): boolean {
  if (viewer.actorKind === "agent") return false;
  if (s.createdBy === viewer.userId) return true;
  if (s.groupId === null) return false;
  return viewer.projectRole === "facilitator" || viewer.projectRole === "groupLead";
}
