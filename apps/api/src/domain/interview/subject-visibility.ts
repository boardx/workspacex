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
