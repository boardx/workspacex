/**
 * 复盘（UC-3.3 AC1）：本场临时挂载 vs 蓝本绑定的差异（F65）。
 *
 * 依据：契约 `listThreadDeviations`。
 *
 * ⚠ 这也是**界面读取「本线程当前挂了什么」的唯一读端口**。契约里没有第二条
 *   「列出本线程挂载」的操作，而界面刷新后必须还能看见自己挂了什么——
 *   否则挂载只活在 React state 里，一次刷新就消失，那不是「持久化的挂载」。
 *
 * ## `bindingSkillIds` 为什么是**入参**而不是一个端口
 *
 * 蓝本绑定住在 `ProjectOrchestrationStorePort`，而那个端口**今天没有适配器**
 * （F63/F64 的落库不在 #467 范围内）。两种写法：
 *
 *   ① 在这里直接返回 `addedVsBinding = 全部临时挂载`、`removedVsBinding = []`，
 *      并在注释里说明「因为基线为空」。—— 那个等式**只在基线为空时成立**，
 *      而基线变得非空的那一天没有任何东西会红。
 *   ② 把基线做成显式入参。差异运算永远是真的差异运算，调用方今天传 `[]`
 *      并在**那里**解释为什么，将来接上编排存储时改的是那一行。
 *
 * 取 ②。这个模块因此没有「今天恰好正确」的分支。
 */
import {
  activeMounts,
  mountListFingerprint,
  type ThreadSkillMount,
} from "../../domain/skill/thread-mount";
import type { ThreadMountStorePort } from "./ports";

export interface ListThreadDeviationsInput {
  readonly threadId: string;
  /**
   * 本线程所属环节的蓝本绑定 skill 集合 —— 差异运算的基线。
   * ⚠ 空数组的含义是「基线里一个都没有」，**不是**「基线未知」。调用方若读不到
   *   基线，应当自己决定如何呈现，而不是传一个空数组让这里算出一份假差异。
   */
  readonly bindingSkillIds: readonly string[];
}

export interface ListThreadDeviationsResult {
  /** 仍然生效的临时挂载。⚠ 已摘除的不在这里——它们的事实在库里，但「现在挂着的」不含它们。 */
  readonly temporary: readonly ThreadSkillMount[];
  readonly addedVsBinding: readonly string[];
  readonly removedVsBinding: readonly string[];
  /**
   * 乐观锁版本号 —— 契约 `mountSkillToThread.in.expectedVersion` 的取值来源。
   *
   * ⚠ 求指纹的是**整份列表（含已摘除的）**，不是 `temporary`：只对生效项求指纹会让
   *   「A 摘了 s1、B 同时挂上 s1」算出同一个版本号 ⇒ 静默覆盖，正是 E5/V8 要挡的。
   *   所以这个字段与 `temporary` 不是同一份数据的两种表达，**不能**由调用方从
   *   `temporary` 反推出来 —— 那也正是它必须由服务端下发的原因。
   */
  readonly version: string;
}

export interface ListThreadDeviationsDeps {
  readonly mounts: ThreadMountStorePort;
}

export async function listThreadDeviations(
  input: ListThreadDeviationsInput,
  deps: ListThreadDeviationsDeps,
): Promise<ListThreadDeviationsResult> {
  const all = await deps.mounts.load(input.threadId);
  const temporary = activeMounts(all);

  const baseline = new Set(input.bindingSkillIds);
  const live = new Set(temporary.map((m) => m.skillId));

  return {
    version: mountListFingerprint(all),
    temporary,
    addedVsBinding: [...live].filter((skillId) => !baseline.has(skillId)),
    // ⚠ 「基线里有、现在没挂着」——注意它读的是 `live`（仍生效），不是 `all`：
    //   一条挂上又摘掉的绑定内 skill 属于「相对绑定被移除」，正是复盘要看的。
    removedVsBinding: [...baseline].filter((skillId) => !live.has(skillId)),
  };
}
