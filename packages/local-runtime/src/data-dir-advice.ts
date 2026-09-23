/**
 * 「打开数据目录」那一步要先说的一句话。
 *
 * ## 为什么需要它（2026-09-23 实测）
 * 菜单里有「打开数据目录」，等于在邀请用户「把这个文件夹拷走当备份」。
 * 而实测证明**那样拷出来的副本打不开**：
 *
 * - `kill -9` 之后重开 → **能恢复**，已提交的行一条不少（三次复现，
 *   `test/crash-recovery.test.ts` 已固化成回归门）。
 * - 应用运行时 `cp -R pgdata` 之后重开 → **PGlite 直接 abort**，
 *   报「it is either open in another process or was left inconsistent by a hard kill」。
 *
 * 两者的差别在于：硬杀留下的是**某一瞬间真实存在过**的磁盘状态，Postgres 的崩溃恢复
 * 认得它；而活拷贝是把不同时刻的文件拼在一起，那个状态**从来没有在任何一刻存在过**。
 * 前者可恢复，后者不可，而且用户只会在真要用它的时候才发现。
 *
 * ## 为什么说在这里而不是写进文档
 * 文档里的警告只有已经在担心的人会读。这句话要出现在**用户正要做那件事的时候**。
 */

export interface DataDirAdvice {
  readonly title: string;
  /**
   * **为什么**不能直接拷。拆成独立字段而不是揉进一段 body，是因为「或」形式的断言
   * 钉不住任何一句——实测：断言写成 `/A|B/` 时，把 A 删掉测试照绿。
   * 一段一个字段，改哪一段红哪一条。
   */
  readonly why: string;
  /** 安全的那条路**以及它凭什么安全**。只说「用那个」而不说为什么，用户没有理由相信。 */
  readonly saferPath: string;
  /** 两条出路，第一条是安全的那条。 */
  readonly actions: readonly [safe: string, proceed: string];
}

export function dataDirAdvice(): DataDirAdvice {
  return {
    title: "要备份的话，别直接拷这个文件夹",
    why:
      "应用正在运行时把数据目录整个拷走，拷到的是不同时刻的文件拼在一起的状态——"
      + "那个状态从来没有真实存在过，之后打不开。实测过：这样拷出来的副本无法恢复。",
    saferPath:
      "「备份我的数据…」走的是数据库自己的一致快照，并且写完会逐个文件核对摘要，核不上就判失败。",
    actions: ["改去做备份", "我知道，仍然打开目录"],
  };
}

/** 拼给对话框看的正文。**唯一一处**拼接，外壳不要自己再拼一份。 */
export function dataDirAdviceBody(a: DataDirAdvice): string {
  return `${a.why}\n\n${a.saferPath}`;
}
