---
bundle: auth
phase: "00"
status: confirmed          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: "yanbin shen"
confirmed_at: "2026-07-30T10:22:44+08:00"
---

# 契约束 `auth` 设计签核

覆盖 feature：**F19 F20 F21 F22**（12 点，自 phase-01 `01-auth` 迁入）
依据 UC：`01-auth/uc-1-5 用邀请码创建组织并注册` · `01-auth/uc-1-1 邮箱账号登录`

## 这个束为什么在 phase-00

phase-00 十八个 feature 全部做完之后，`devapp.boardx.us` **仍然是空壳**——
`/identity/*` 一律 401，因为真实认证在 phase-01。而 phase-00 剩余的 feature
**没有一个能改变这件事**。

⇒ 2026-07-29 裁决（选项 A）：把 `01-auth` 的**最小可用切片**迁进 phase-00。

**为什么是这四件而不是整个模块**：`01-auth` 共 16 件 42 点，但
- 5 件带 `needs_ui_signoff`，而 phase-01 的 `ui-signoff.md` 仍是 `pending`（ADR-003 关卡）
- UI 重的那几件互相缠着（F04←F12/F15，F12←F15）
- phase-01 **没有 `contracts/` 目录**，整套四件套一件没做

这四件**全部不带 `needs_ui_signoff`**，且依赖链是一条直线：
`F19（建组织+注册）→ F20（登录）→ F21（找回密码）`，`F19 → F22（多组织）`。

⚠ 原 phase-01 `F03`（设备与会话列表）**带 UI 签核，未迁入**——
虽然它在功能上属于同一片。这是刻意的取舍，不是遗漏。

## 四件产出物

| # | 文件 | 内容 |
|---|---|---|
| ① | `domain.md` | 凭据/会话/邀请码的实体与不变量 |
| ② | `usecases.md` | 用例接口 + **失败模式穷举**（防枚举、限速、锁定、核销竞态） |
| ③ | `packages/contracts/src/auth.ts` | zod 单源 |
| ④ | `coverage.md` | R12 逐条映射 |

## 签核前请重点确认

- [ ] **凭据形态**：UC-0.6 A-3 当时刻意不决定（「Guard 只断言 principal 非空」）。
      本束必须定下来。见 `domain.md` 的候选与推荐。
- [ ] **会话存储**：现在是**进程内**（`InMemorySessionStore`），不跨副本不跨重启。
      本束要不要一并换成 Redis？`docker-compose.deploy.yml` 里 redis 已持久化，就是为它准备的。
- [ ] **邀请码「一码一组织、事务性核销」的并发语义**：两个人同时用同一个码，
      必须恰好一个成功。这是 F19 最容易做错的一点，且做错时**表现为两个组织都建出来了**。
- [ ] **防枚举**：登录失败提示不得区分「邮箱不存在」与「密码错误」。
      ⚠ 这条容易被「更好的用户体验」侵蚀，需要断言而不是约定。

## 确认动作

人类核对后把 frontmatter 的 `status` 改为 `confirmed`。
⚠ **这是人的动作，不是 agent 的。** 在此之前 `new-sprint` 会拒绝把 F19–F22 开进 sprint。
