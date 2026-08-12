---
name: dashboard
description: >
  激活条件：任何 agent 需要「全局现状总览」时——开工前建立全局感、给人类汇报进展、
  判断该不该开重活、找等人类签核的清单。关键词：dashboard、指挥板、全局进度、
  现在什么状况、汇报进展、总结全局。
---

# Dashboard Skill — 全局指挥板（所有 agent 通用）

> 一条命令回答「整个仓库现在什么状况」。与 `pnpm harness board`（core-loop
> 专用）和 `pnpm harness readiness`（取活队列）互补，不替代它们。

## 何时使用

- **开工前**：30 秒建立全局感——谁占着在编槽、PR 队列多长、机器能不能开重活。
- **汇报前**：给人类/coordinator 写进展总结时，用它的输出当底稿，不要凭记忆写。
- **裁决前**：coordinator 判断派工顺序、合并顺序时的第一手盘面。

## 用法

```bash
pnpm harness dashboard              # 全量（现查 gh + git + 磁盘 + 本机）
pnpm harness dashboard --no-remote  # 离线快速模式（跳过 gh/git fetch）
```

输出：stdout 全文 + `.harness/state/DASHBOARD.md`（派生视图）。 <!-- 运行时生成物，gitignored；skill-doctor:ignore -->

## 它回答的六个问题

| 板块 | 数据源（全是活信号） |
|---|---|
| PR 队列（几个开放、哪个可合） | `gh pr list --json`，现查 |
| 近 24h 合入了什么 | `git log origin/main --since`，先 fetch |
| feature 状态分布 + 谁占在编槽 | 各 phase `feature_list.json`（权威清单）实读 |
| 等人类签核的有哪几份 | 磁盘扫 `contracts/**` 与 `design-deltas/**` 的 `status: pending` |
| 等人类 Accept 的提案 | `docs/proposals/*.md` 头部 `状态：Proposed` |
| 本机能不能开重活 | load/核数 + wsx 隔离栈数（准入闸上限 2） |

## 铁律

1. **它是派生视图不是权威**。任何决策引用它之前，重跑一次；`DASHBOARD.md`
   头部的时间戳超过 30 分钟就当它不存在（静态痕迹 ≠ 动态事实）。
2. **禁止手改 `DASHBOARD.md`**——想让板面变化，去改真实状态（合 PR、签核、
   释放栈），重跑命令。
3. **不要把它 commit 进 PR**。它在 `.harness/state/` 且每跑必变，带进 diff
   只会制造冲突（如果 lint 抱怨未忽略，加 .gitignore 而不是提交它）。
4. coordinator 面向人类的 HTML 指挥板（claude.ai artifact）是**另一层**：
   coord-main 以本命令输出为底稿手工润色发布。其他 agent 不发布 artifact。

## 扩展约定

新增板块 = 在 `dashboard.mjs` 加一个「现查」小节，禁止读快照文件当数据源；
每块必须能回答「这个数字是刚刚查出来的吗」。改完在本文件的表格里登记一行。
