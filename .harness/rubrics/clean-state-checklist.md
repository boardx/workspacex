# 干净收尾检查清单(Clean State Checklist)

每次会话结束前逐项确认,确保下一轮无需人工修复即可开工:

- [ ] **每个 agent/subagent 完成一件工作（PR 已开出/已合并）后立即回收自己占用的资源**
  （2026-08-08 追加，事故背景：一次 3-worktree 并行派工 + 之前几轮遗留，
  实测同一台机器上累积了 221 个 worktree，其中 192 个已经零改动纯属遗留、
  外加十几个孤儿 docker compose 栈（postgres/redis）常驻，把 load average
  打到 62.8（10 核机器），三个正常并行的 subagent 因此被"饥饿"，表现得像
  卡死）——不是等会话结束才清，是**每完成一件事就清一次**：
  - `git worktree remove <path>`（工作完成、PR 已开出后；不确定还需不需要
    这个 worktree 时才保留，"可能还要用"不是保留理由，git 分支本身不会丢，
    随时能重新 `git worktree add`）。
  - `docker compose -f infra/docker-compose.yml down`（`verify:fullstack-smoke`
    这类起了真实数据库的验证跑完就收，不留一份"待会可能还要测"的活库）。
  - 协调者（coord-main/module-coordinator）派发多个并行 subagent 时，这条要
    写进派发 prompt 里明确要求，不能假设 subagent 自己会想到；协调者自己
    定期跑 `pnpm harness sweep-worktrees` / `pnpm harness sweep-docker` 巡检，
    不要等 `uptime` 报警才想起来查。
- [ ] 标准启动路径仍可用(`pnpm -w run dev`)。
- [ ] 标准验证仍能跑——按 [ADR-106](../../docs/adr/ADR-106-verify-base-affected.md) 选档
      (`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`)。
- [ ] 进度日志已更新(对应 scope 的 `progress.md`)。
- [ ] 会话交接已写(`session-handoff.md`)。
- [ ] 功能清单真实反映 passing / 未验证边界——**没有假 passing**。
- [ ] 没有半成品处于未记录状态。
- [ ] 同一时刻只有一个 feature 处于 `in_progress`。
- [ ] 关键运行输出已归档到 sprint 的 `evidence/`。
- [ ] **本 worktree 起过的 docker compose 栈已 down**（`docker compose -f infra/docker-compose.yml down`）——
  feature/PR 收尾后不需要保留一份实时可跑的数据库。跑
  `pnpm harness sweep-docker` 核实没有本会话遗留的孤儿栈（见 ADR-007）。
- [ ] **主 checkout 干净且不落后 origin/main**（`git status --porcelain` 为空、
  `git rev-list --count HEAD..origin/main` 为 0）。干活一律在 worktree 里,主 checkout
  只当 main 的镜像——它一漂,谁在里面读代码都是在读旧仓库,把现状误报成缺口。
  2026-07-15 实测:主 checkout 落后 90 个提交,working tree 里躺着 4 个**旧于 main**的
  改动(其中 `registry.yaml` 还处于 staged,内容是删掉 `portal-broker`,一次 `git commit`
  就会打挂 devportal 自助发 token)+ 一坨 117MB 的 `.next.corrupt-*` 残骸。全部是废弃
  工作流的化石,没有一件是真丢的工作——但它足以让人把已交付的功能误判成没做。
