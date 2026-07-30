/**
 * 蓝本与版本的领域模型（F17，`domain.md` §一 定义层 / 不变量 I-3 I-7）。
 *
 * 纯函数与纯数据：没有时钟、没有 I/O、没有存储。落库、事务与并发是外层的事。
 *
 * ## 本文件只落三条能写成断言的性质
 *
 * · **I-3** `versionNumber` 单调递增、不复用、不缺号；**发布失败不占号**。
 * · **I-7** 归档**禁止新增绑定**，但**不禁止存量绑定的实例化**，且不影响版本可达性。
 *   ⚠ 这一条是防现场跑挂的关键：若归档即禁止实例化，进行中的工作坊切议程环节会当场失败。
 * · **O-18 ②** 回滚 = **新建一个内容等同旧版的新版本**，版本号只增不减、历史线性；
 *   **不存在「当前版本指针被改回 v3」的状态**。
 *
 * ## 刻意**没有**的东西
 *
 * · **`maintainerIds` 的判据** —— 「谁是维护者」是 D-1 未裁（`KNOWN_CONTRACT_GAPS.T2`），
 *   `domain.md:49` 自己标着「[待定 —— 需人类裁决]」。裁定前不得写死。
 * · **`BlueprintContent` 的字段表** —— 各配置项面板内部的形状属 F18+ 的范围
 *   （`domain.md` §三 明写本束只定义「目录、完成度、进入入口与保存契约」）。
 *   这里把它当作不透明的冻结快照：本 feature 要守的是它**写入后不再改**，不是它长什么样。
 */

import type { z } from "zod";
import { templates } from "@repo/contracts";

export type BlueprintState = z.infer<typeof templates.BlueprintState>;
export type BlueprintVersionState = Extract<BlueprintState, "published" | "archived">;

/**
 * 一条**不可变版本**记录。
 *
 * ⚠ 「快照」= 这样一条记录（`domain.md` 逐字），**不是**应用层的一个布尔标记，
 * 也**不是**运行时从 `Blueprint` 当前状态反查出来的东西。
 */
export interface BlueprintVersion {
  readonly id: string;
  readonly blueprintId: string;
  /** I-3：一个蓝本内单调递增、不复用、不缺号 */
  readonly versionNumber: number;
  /** 冻结快照。⚠ 一经写入永不改写（I-2）——所以整棵都是 readonly */
  readonly content: Readonly<Record<string, unknown>>;
  /** 版本差异：改了哪几项设计配置（uc-2-4 V6）。⚠ key 取自定义表，不是自由文本 */
  readonly changedDesignFacetKeys: readonly string[];
  /** O-18 ②：回滚产生的新版本记它从哪一版回来的；非回滚为 null */
  readonly rolledBackFrom: string | null;
  readonly state: BlueprintVersionState;
}

/**
 * 下一个版本号。
 *
 * ⚠ 取的是**历史最大号 + 1**，不是「已发布版本数 + 1」，也不是「当前版本号 + 1」：
 * 前者在归档后会缩水并**复用号**，后者在回滚后会倒退——两者都直接违反 I-3。
 * 空历史 ⇒ 1（版本号从 1 起，契约 `versionNumber: int().positive()`）。
 */
export function nextVersionNumber(history: readonly BlueprintVersion[]): number {
  return history.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
}

/**
 * 版本号序列是否满足 I-3（单调递增、不复用、不缺号）。
 *
 * ⚠ 「发布失败不占号」在这里表现为：**失败的那次根本不产生记录**，
 * 所以下一次成功发布拿到的号 = 失败前的号。断言写在序列上而不是写在流程上，
 * 是因为流程可以有很多条，而序列只有一条。
 */
export function versionNumbersSatisfyI3(history: readonly BlueprintVersion[]): boolean {
  const numbers = history.map((v) => v.versionNumber).sort((a, b) => a - b);
  return numbers.every((n, i) => n === i + 1);
}

/**
 * 回滚 = 新建一个内容等同目标版本的新版本（O-18 ②）。
 *
 * ⚠ 返回的是**新记录**，不是被改写的旧记录：v5 回到 v3 的内容 ⇒ 产生 **v6（内容 = v3）**。
 * 「把当前版本指针改回 v3」这个状态在本模型里**不存在**——它一旦存在，
 * 「快照不漂移」就要在两种历史形态下各证一遍。
 */
export function rollbackToVersion(
  history: readonly BlueprintVersion[],
  target: BlueprintVersion,
  newVersionId: string,
): BlueprintVersion {
  return {
    id: newVersionId,
    blueprintId: target.blueprintId,
    versionNumber: nextVersionNumber(history),
    content: target.content,
    changedDesignFacetKeys: target.changedDesignFacetKeys,
    rolledBackFrom: target.id,
    state: "published",
  };
}

/**
 * I-7 的两半，**刻意是两个函数**。
 *
 * 归档只回答「还能不能**新增**绑定」。把它折叠成一个 `isUsable(version)` 会让
 * 「新建项目时不该再选它」和「已经在跑的项目还能不能开画布」共用一个答案——
 * 而那两个答案必须不同，否则进行中的工作坊会在切议程环节时当场失败。
 */
export function canBindNewProject(version: BlueprintVersion): boolean {
  return version.state === "published";
}

/** 存量绑定的实例化**不受归档影响**（I-7 ②③）。⚠ 恒 true 是结论，不是占位 */
export function canInstantiateExistingBinding(_version: BlueprintVersion): boolean {
  return true;
}

/**
 * 草稿态不显示版本号（uc-2-4 R7）。
 *
 * ⚠ 返回 `null` 而不是 `0` 或 `"—"`：0 是一个会被拿去做算术的数，
 * 而「没有版本号」和「第 0 版」不是一回事。
 */
export function displayVersionNumber(
  state: BlueprintState,
  currentVersion: BlueprintVersion | null,
): number | null {
  return state === "draft" || currentVersion === null ? null : currentVersion.versionNumber;
}
