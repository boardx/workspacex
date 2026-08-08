# Agent 资源释放 SOP（不遵守，系统会崩）

> 人类原话（2026-08-08 实测事故后）："需要加入一个sop给所有的agent，就是需要及时的
> 释放stack的资源，否则系统迟早会崩溃"。

## 已经发生过的真实事故，不是假设

2026-08-08，本机 load average 飙到 **66**（正常应在个位数），根因逐层排查：
- `docker ps -a` 发现 **100+ 个孤儿容器**（`wsx-<hash>-postgres-1`/`wsx-<hash>-redis-1`），
  多数标 `unhealthy`、存活 6-35 小时——早就跑完了，从未被清理。
- `docker system df` 显示 **448 个本地 volume，仅 1 个在用，7GB+ 可回收**——
  每个孤儿容器的 postgres 数据卷都留了下来，从未 `down -v`。
- 长期高负载最终导致本机 **Docker daemon 直接崩溃**，殃及所有正在跑测试的 agent
  （包括跟这次事故无关的并行工作线）。
- 清理动作（`docker container prune` + `docker volume prune` + `docker builder prune`）
  一次性回收约 **9GB**，load 才恢复正常。

这不是"效率问题"，是"不清理，系统迟早连接不上、跑不动、甚至直接崩掉"的真实故障链路。

## 对所有 agent 的硬性要求

1. **每次起 docker compose 栈跑测试（`pnpm harness verify`/`pnpm test`/e2e 之类），
   跑完之后（无论成功还是失败）确认栈被正常关掉。** 本仓的 test-isolation 机制
   （`with-test-isolation.ts`）设计上会在测试进程正常退出时自动 `docker compose
   down -v`——但会话被打断、进程被杀、Claude Code 被强制重启这类非正常退出路径
   下，清理钩子来不及跑，栈就会变成孤儿。**你的 session 一旦要结束或被中断，
   主动确认一次自己名下的栈有没有清干净，不要假设框架一定会替你收尾。**
2. **检查命令**：`docker ps -a --filter name=wsx- --format "table {{.Names}}\t{{.Status}}"`。
   看到自己这次任务对应的栈还在跑但工作已经结束，主动 `docker compose -p <project> down -v`
   （project 名就是容器名前缀，如 `wsx-<hash>`）。看到别人／别的会话仍在用的栈
   （状态健康、最近几分钟内起的），**不要动**——参照 2026-08-08 当天 #728 那条线的
   实际做法：核实是自己的还是别人的，只清自己的。
3. **不要因为"图省事"而不清理。** 一个 agent 留下的孤儿栈，代价由同一台机器上
   所有并行工作的 agent 共同承担——这正是这次事故的形状：一个任务的残留最终
   拖垮了所有其他任务。
4. **系统级清理工具**：仓库自带 `pnpm harness sweep-docker [--apply]`（ADR-007，
   巡检孤儿 docker compose 栈；不带 `--apply` 是 dry-run）。如果这个命令本身因为
   Docker daemon 未就绪而报错（`failed to connect to the docker API`），先确认
   Docker Desktop 本身在跑（`docker info`），必要时重启它，再重试。
5. **不只是 docker**：同样的纪律适用于任何长期占用系统资源的东西——遗留的
   `next dev`/`langgraph dev`/后台 SSH 隧道等进程，任务结束前一并检查、关掉。

## 谁来执行这条 SOP

**不是一次性清理，是每个 agent 每次任务收尾时的常规动作**——这条 SOP 写进
`.harness/instructions/`，与 AGENTS.md 的"干净收尾"清单同级，任何读过 AGENTS.md
的 agent 都能找到它。coordinator/coord-main 角色额外负责：发现系统级异常负载时
（`uptime` 明显偏高、大量任务突然变慢/报连接错误），主动排查是不是资源泄漏，
不要默认归因为"随机 flake"。
