import { spawnSync } from "node:child_process";

export interface ShResult { code: number; stdout: string; stderr: string; }

// 2026-08-15（issue TBD，F156 sprint-verify 反复静默假死排查发现）：
// spawnSync 默认对 stdout/stderr 各开一条 pipe，encoding:"utf8" 触发 Node 逐块攒 Buffer。
// 当子进程（如 verify:quick 跑 turbo typecheck+lint+test --affected）同时在 stdout 和
// stderr 上产出大量并发输出时，Node 的 spawnSync 同步读取实现在两条管道间轮转读取，
// 一条管道的 OS 缓冲区（默认 64KB）写满、另一条还没轮到读，子进程的 write() 就会阻塞——
// 表现为父进程「挂起不动、子进程 CPU 时间不再增长」，这正是 F156 四次
// `pnpm harness verify --sprint 01/10` 复现的现象（同一条命令绕开这层直接跑
// 完全正常，8m34s 跑完）。同时默认 maxBuffer=1MB，超限会直接 SIGTERM 子进程
// （另一次复现里看到的 exit 143 就是这个）。
// 修法：用 shell 级 `2>&1` 把 stderr 并入 stdout，只剩一条管道，消除双管道竞争；
// 同时把 maxBuffer 调大到 200MB，避免大体量真栈输出被默认 1MB 上限杀掉。
// 调用方全部只是把 stdout/stderr 拼在一起显示（未见任何调用方依赖两者分离的语义，
// 已逐个核对 verify.ts / pr-queue.ts / sync-github.ts / verify-cache.ts），故此变更安全。
export function sh(cmd: string, cwd?: string): ShResult {
  // 用子 shell `( … )` 包一层再重定向：`cmd 2>&1` 只对整段脚本的最后一条语句生效，
  // 多语句/多行 cmd（比如带 `&` 后台任务 + `wait`）会漏掉前面语句的 stderr；
  // 包一层子 shell 后重定向对整段脚本生效，单条命令的常见调用形态不受影响。
  const r = spawnSync("bash", ["-c", `(${cmd}) 2>&1`], { cwd, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
