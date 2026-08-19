// sweep-docker.ts — 巡检并（可选）清理孤儿 docker compose 栈。
//
// 修的是这个漏洞：每个 worktree 通过 scripts/init-worktree-env.sh 起一套独占的
// postgres+redis+minio（见 parallel-dev-workflow.md §5），但 feature/PR 收尾后经常
// 忘了 `docker compose down`——worktree 目录被删了，docker 栈却继续跑，长期累积
// 成真实的 host 级资源耗尽（本仓库已实测复现：某次巡检时 20 个并发栈里 7 个是这类
// 孤儿，同一晚另一次验证因此撞上 postgres 反复 crash-loop 进恢复模式）。见 ADR-007。
//
// 用 `docker compose ls --format json` 的 ConfigFiles 字段拿到每个栈的原始
// compose 文件路径——这条路径的上一级目录就是当初起这个栈的 worktree 根目录。
// 如果这个目录已经不存在于磁盘上，说明 worktree 早就被删了但 docker 没跟着清理，
// 这是唯一权威、零歧义的孤儿判定（不猜测 PR 状态、不看 git 分支——那些即使显示
// "已合并"，worktree 本身仍可能因为其它合法原因还留着）。
//
// 默认只报告，不清理；加 --apply 才会真的 down 掉判定为孤儿的栈（同 harness sync
// 的 dry-run 默认 + --apply 执行的约定）。
//
// ## ⚠ 2026-08-19 补：`compose ls` 只列**运行中**的项目，另两类残留曾完全不在视野里
//
// 实测：本文件报「14 个栈，0 个孤儿」——**在只看 compose ls 的判据下完全正确**，
// 而同一时刻机器上真实存在 **37 个已 exited 容器**（最老 2 天、退出码 255 = 被杀）
// 与 **24 个悬空卷**，容器总数 65、卷总数 52。一个 worker 那天连推五次才成功，
// 四次红在四个**不在自己 diff 里**的文件、单独跑全绿——就是这些看不见的残留在耗资源，
// 而巡检报绿。
//
// ⇒ 「报绿」≠「机器干净」。所以现在**除了** compose ls，还额外巡检：
//    ① 已停止容器（按 compose label 归项目，判据同上：worktree 在不在）；
//    ② 悬空卷（没有任何容器引用）。
// 判定逻辑抽到 `lib/docker-residue.ts` 的纯函数里，好让"该留的真留住了"能被直测
// （真起容器的测试又慢又抖，抖动最后会被人用 retry 掩盖）。
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { sh } from "./lib/sh";
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import { classifyResidue, type ContainerRecord } from "./lib/docker-residue";

interface ComposeProject {
  Name: string;
  Status: string;
  ConfigFiles: string;
}

interface OrphanCandidate {
  name: string;
  status: string;
  worktreeDir: string;
}

function listComposeProjects(): ComposeProject[] {
  const result = sh("docker compose ls --format json");
  if (result.code !== 0) {
    throw new Error(`docker compose ls 失败：${result.stderr || result.stdout}`);
  }
  const trimmed = result.stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as ComposeProject[];
}

/**
 * 所有容器（含已停止），带 compose label。⚠ 用 `--format json` 逐行输出，
 * 不用 `--format '{{...}}'` 拼字符串——容器名/路径里出现分隔符时后者会静默错位。
 */
function listAllContainers(): ContainerRecord[] {
  const r = sh(
    "docker ps -a --format '{{json .}}'",
  );
  if (r.code !== 0) return [];
  const out: ContainerRecord[] = [];
  for (const line of r.stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    let row: { Names?: string; State?: string; Labels?: string };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    const name = row.Names ?? "";
    if (!name) continue;
    // `Labels` 是 `k=v,k=v` 的扁平串。逗号也可能出现在值里，但这两个 key 的值
    // （项目名 / 文件路径）都不含逗号，所以按 `,` 切在这里是安全的。
    const labels = new Map<string, string>();
    for (const kv of (row.Labels ?? "").split(",")) {
      const i = kv.indexOf("=");
      if (i > 0) labels.set(kv.slice(0, i), kv.slice(i + 1));
    }
    out.push({
      name,
      project: labels.get("com.docker.compose.project") ?? null,
      configFiles: labels.get("com.docker.compose.project.config_files") ?? null,
      running: (row.State ?? "") === "running",
    });
  }
  return out;
}

/**
 * 悬空卷（没有任何容器引用），带它所属的 compose 项目。
 *
 * ⚠⚠ **不要用 `docker volume prune -f` 清这些**。实测（2026-08-19）：本仓的栈用的是
 * **具名**卷（`<project>_postgres_data` 这种，带 compose label），而 `prune` 默认
 * **只删匿名卷** —— 它会**退出码 0 + "Total reclaimed space: 0B"**，一个都没删。
 * 上一版这里就是信了退出码，然后打印「已清理悬空卷（6 个）」这句假话。
 *
 * ⚠⚠ 也**不要**改成 `prune -af`。实测那 6 个卷属于 `codex-…` 项目 —— **别的会话的数据**。
 * 无差别 prune 会把它们删掉。判据必须还是那一条：**该项目的 worktree 是否还在**。
 */
function listDanglingVolumes(): { name: string; project: string | null }[] {
  const r = sh("docker volume ls -qf dangling=true");
  if (r.code !== 0) return [];
  const names = r.stdout.trim().split("\n").filter((l) => l.trim().length > 0);
  return names.map((name) => {
    const p = sh(
      `docker volume inspect -f '{{index .Labels "com.docker.compose.project"}}' ${JSON.stringify(name)}`,
    );
    const raw = p.code === 0 ? p.stdout.trim() : "";
    return { name, project: raw === "" || raw === "<no value>" ? null : raw };
  });
}

/**
 * 第二段巡检：已停止容器 + 悬空卷。与上面的 compose ls 段**判据相同、范围更宽**。
 * ⚠ 只清"worktree 已消失且该项目无任何运行中容器"的——见 `docker-residue.ts` 头注。
 */
function sweepStoppedAndVolumes(apply: boolean): void {
  const containers = listAllContainers();
  const verdict = classifyResidue(containers, existsSync);
  const dangling = listDanglingVolumes();

  const stoppedInOrphans = containers.filter(
    (c) => !c.running && c.project !== null && verdict.orphanProjects.includes(c.project),
  );
  // 只清"属于孤儿项目"的卷。归属不明的（无 compose label）与属于活项目的一律只报告：
  // 无法归因的东西不删，是这份工具唯一说得过去的默认。
  const volumesInOrphans = dangling.filter(
    (v) => v.project !== null && verdict.orphanProjects.includes(v.project),
  );
  const volumesUnattributed = dangling.filter((v) => v.project === null);

  log.info(
    `已停止容器/悬空卷巡检：${containers.length} 个容器（${verdict.liveProjects.length} 个项目的 worktree 仍在，` +
    `${verdict.orphanProjects.length} 个项目已成孤儿）、${dangling.length} 个悬空卷。`,
  );
  if (verdict.unclassified.length > 0) {
    log.info(`  ${verdict.unclassified.length} 个容器缺 compose label，不猜也不清。`);
  }
  if (volumesUnattributed.length > 0) {
    log.info(`  ${volumesUnattributed.length} 个悬空卷归属不明（无 compose label），只报告不清理。`);
  }
  const foreignVolumes = dangling.length - volumesInOrphans.length - volumesUnattributed.length;
  if (foreignVolumes > 0) {
    log.info(`  ${foreignVolumes} 个悬空卷属于 worktree 仍在的项目（别的会话），不动。`);
  }
  if (stoppedInOrphans.length === 0 && volumesInOrphans.length === 0) {
    log.info("  没有可清理的已停止容器或悬空卷。");
    return;
  }
  for (const p of verdict.orphanProjects) {
    log.info(`  ⚠ 孤儿项目（已停止）：${p}`);
  }
  if (!apply) {
    log.info(
      `  加 --apply 清理这 ${stoppedInOrphans.length} 个已停止容器与 ${volumesInOrphans.length} 个悬空卷。`,
    );
    return;
  }
  for (const c of stoppedInOrphans) {
    const r = sh(`docker rm -v ${JSON.stringify(c.name)}`);
    if (r.code === 0) log.ok(`已删除容器：${c.name}`);
    else log.err(`删除失败：${c.name} — ${r.stderr || r.stdout}`);
  }
  // ⚠ 逐个具名删除，**并且回读**。不信退出码：见 `listDanglingVolumes` 头注那条
  //   「prune 退出 0 却删了 0 个」的实测教训——报成功比不报更坏。
  let removedVolumes = 0;
  for (const v of volumesInOrphans) {
    const r = sh(`docker volume rm ${JSON.stringify(v.name)}`);
    if (r.code === 0) removedVolumes += 1;
    else log.err(`删除卷失败：${v.name} — ${r.stderr || r.stdout}`);
  }
  if (volumesInOrphans.length > 0) {
    if (removedVolumes === volumesInOrphans.length) {
      log.ok(`已清理悬空卷（${removedVolumes} 个）`);
    } else {
      log.err(`悬空卷只清掉 ${removedVolumes}/${volumesInOrphans.length} 个——上面有失败原因`);
    }
  }
}

export function sweepDocker(args: Args): void {
  const apply = !!args.flags["apply"];

  let projects: ComposeProject[];
  try {
    projects = listComposeProjects();
  } catch (e) {
    log.err((e as Error).message);
    return;
  }

  if (projects.length === 0) {
    log.info("没有正在运行的 docker compose 栈。");
    // ⚠ 不能在这里 return：已停止容器与悬空卷正是「compose ls 看不见」的那两类，
    //   compose ls 为空时它们**更可能**存在（栈全停了）。
    sweepStoppedAndVolumes(apply);
    return;
  }

  const orphans: OrphanCandidate[] = [];
  const alive: string[] = [];

  for (const p of projects) {
    // ConfigFiles 形如 <worktree>/infra/docker-compose.yml
    const worktreeDir = dirname(dirname(p.ConfigFiles));
    if (existsSync(worktreeDir)) {
      alive.push(p.Name);
      continue;
    }
    orphans.push({ name: p.Name, status: p.Status, worktreeDir });
  }

  log.info(`巡检了 ${projects.length} 个 docker compose 栈：${alive.length} 个对应的 worktree 仍存在，${orphans.length} 个是孤儿。`);

  if (orphans.length === 0) {
    log.info("没有发现孤儿栈（运行中的 compose 项目里）。");
    // ⚠ 同上：这条"绿"只覆盖运行中的项目，第二段必须照跑，否则就是本文件头注
    //   记的那个「报绿 ≠ 干净」的坑。
    sweepStoppedAndVolumes(apply);
    return;
  }

  for (const o of orphans) {
    log.info(`  ⚠ 孤儿：${o.name}（${o.status}）——原 worktree 已不存在：${o.worktreeDir}`);
  }

  if (!apply) {
    log.info(`加 --apply 实际清理这 ${orphans.length} 个孤儿栈（docker compose -p <name> down -v）。`);
    return;
  }

  log.info(`--apply：开始清理 ${orphans.length} 个孤儿栈...`);
  for (const o of orphans) {
    const result = sh(`docker compose -p ${JSON.stringify(o.name)} down -v`);
    if (result.code === 0) {
      log.ok(`已清理：${o.name}`);
    } else {
      log.err(`清理失败：${o.name} — ${result.stderr || result.stdout}`);
    }
  }
  sweepStoppedAndVolumes(apply);
}
