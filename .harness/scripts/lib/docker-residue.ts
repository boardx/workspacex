// docker-residue.ts —— 「这台机器上哪些 docker 残留该清」的**纯判定**。
//
// ## 为什么把判定从 sweep-docker.ts 抽出来
//
// `sweep-docker.ts` 原本只巡检 `docker compose ls` —— 那条命令**只列运行中的项目**。
// 于是两类残留完全在它的视野之外，长期静默堆积：
//   ① 已 exited 的容器（compose 项目不再"运行中"，`compose ls` 不返回它）；
//   ② 悬空卷（栈被 down 掉但没带 `-v`，卷留下）。
//
// 2026-08-19 实测（这就是本文件存在的原因）：`sweep-docker` 报「14 个栈，0 个孤儿」
// —— 在它自己的判据下**完全正确**，而同一时刻机器上真实存在 **37 个已停止容器**
// （最老 2 天前、退出码 255 = 被杀）与 **24 个悬空卷**，容器总数 65、卷总数 52。
// 一个 worker 那天连推五次才成功，四次红在四个**不在自己 diff 里**的文件、单独跑全绿
// —— 就是这些看不见的残留在耗资源，而巡检工具报绿。
//
// ⇒ 「报绿」和「干净」是两件事。工具的视野边界必须和它的结论一起被写下来，
//   否则下一个人会把「0 个孤儿」读成「机器是干净的」。
//
// ## 判据不变：worktree 是否还在磁盘上
//
// 与 `sweep-docker.ts` 头注那条**同一条**权威判据，不新造第二套：起这个栈的
// compose 文件路径的上两级 = 当初的 worktree 根目录；目录不在了 ⇒ 孤儿。
// 不猜 PR 状态、不看分支是否已合并（那些即使显示"已合并"，worktree 也可能因其它
// 合法原因还留着）。
//
// ⚠ **停止的容器不等于孤儿**：worktree 还在的会话可能只是暂停、随时会重启它。
//   误清活会话的容器比留着残留坏得多，所以 worktree 在 ⇒ 一律保留。
//
// ## 为什么是纯函数
//
// 判定不碰 docker，只吃「清单 + 一个 `目录是否存在` 谓词」。于是这套判据能被
// 四格覆盖直测（含"该留的真留住了"那两格），不需要真起容器 —— 真 docker 测试
// 又慢又抖，而抖动最后会被人用 retry 掩盖掉。I/O 留在 `sweep-docker.ts` 的边缘。
export interface ContainerRecord {
  readonly name: string;
  /** compose 项目名（label `com.docker.compose.project`）；拿不到时为 null。 */
  readonly project: string | null;
  /** label `com.docker.compose.project.config_files`；拿不到时为 null。 */
  readonly configFiles: string | null;
  readonly running: boolean;
}

export interface ResidueVerdict {
  /** 可清理：worktree 已不存在，且该项目**没有任何**运行中容器。 */
  readonly orphanProjects: readonly string[];
  /** 刻意保留：worktree 仍在（会话可能重启它）。 */
  readonly liveProjects: readonly string[];
  /** 判不了：缺 compose label，不猜、不清。 */
  readonly unclassified: readonly string[];
}

/** `<worktree>/<子目录>/docker-compose.yml` ⇒ `<worktree>`（与 sweep-docker.ts 一致）。 */
export function worktreeDirOf(configFiles: string): string {
  const parts = configFiles.split("/");
  return parts.slice(0, Math.max(0, parts.length - 2)).join("/") || "/";
}

export function classifyResidue(
  containers: readonly ContainerRecord[],
  dirExists: (path: string) => boolean,
): ResidueVerdict {
  const orphan = new Set<string>();
  const live = new Set<string>();
  const unclassified = new Set<string>();
  /** 项目里只要有**一个**运行中容器，整个项目都不许清。 */
  const hasRunning = new Set<string>();

  for (const c of containers) {
    if (c.project === null || c.configFiles === null) {
      unclassified.add(c.name);
      continue;
    }
    if (c.running) hasRunning.add(c.project);
  }

  for (const c of containers) {
    if (c.project === null || c.configFiles === null) continue;
    if (dirExists(worktreeDirOf(c.configFiles))) {
      live.add(c.project);
    } else {
      orphan.add(c.project);
    }
  }

  // ⚠ 安全闸：worktree 已消失、但仍有容器在跑 ⇒ **不清**。
  //   可能是有人刚删了 worktree 而进程还没退，此刻 down 掉会打断正在跑的东西。
  for (const p of hasRunning) orphan.delete(p);
  // 同一项目若既被判 live 又被判 orphan（配置路径不一致的边缘情形），保守留下。
  for (const p of live) orphan.delete(p);

  return {
    orphanProjects: [...orphan].sort(),
    liveProjects: [...live].sort(),
    unclassified: [...unclassified].sort(),
  };
}
