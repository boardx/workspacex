# 待落地补丁（`pending-patches/`）

> 这里放的是**已经做好、但暂时不该落在当前分支**的改动。
> 它们不是废弃物——**每一份都必须有一个明确的落地时机**，写在下表里。
> 一份补丁如果找不到落地时机，那它就是被悄悄丢掉了，不要放进来。

| 补丁 | 内容 | 为什么现在不落 | 什么时候落 |
|---|---|---|---|
| `2026-07-31-phase-02-03-verification-commands.patch` | phase-02（46 feature）与 phase-03（47 feature）的 `feature_list.json` 里 **93 条验证命令**从 `pnpm vitest run …` 改为 `pnpm --filter api exec vitest run …` 等可执行形态。**改动 100% 只是命令字符串**，无新增 feature、无状态字段、无 `verification` 以外的键（已用 `git diff \| grep -oE '"[a-z_]+":'` 机械核对，输出为空） | 见下方「为什么这份补丁被挪出来」 | **phase-02 / phase-03 立项时**，与该阶段的契约束一起落。届时先 `git apply`，再跑 `node .harness/scripts/lint-verification-can-fail.mjs` 复验 |

## 为什么这份补丁被挪出来

`.git/hooks/pre-push` 的规则是「本次 push 触碰了哪个 phase 的 `feature_list.json`
或 `sprints/**`，就体检哪个 phase」，注释逐字写着 **「谁触碰谁先还」**。

phase-02 / phase-03 有一条**早就存在、且完全正确**的红：
`has_ui: true` ∧ 零契约束 ⇒ `auditSignoff` FAIL（ADR-023 决策一）。
它挡的正是它该挡的——这两个阶段**现在没有资格开工**。

于是出现了一个错误的耦合：**phase-01 的 push 被 phase-02 的开工资格挡住了**，
而这次 push 与 phase-02 的开工资格毫无关系。

四种做法里三种是造假绿：

| 做法 | 为什么不做 |
|---|---|
| 建 `phases/phase-0{2,3}-*/contracts/<束>/` 空壳 | 门控自己的报错文案逐字写着**「不要为了消红而建一个空壳束」**，空 `covers` 会在下一条红里被抓住 |
| 撤 `roadmap.yaml` 的 `has_ui` | 这两个阶段**确实有界面**（`components/survey/` `components/tasks/` `components/brain/` 已建成）。撤它是在磁盘上写假话 |
| `git push --no-verify` | 绕过门控。而且这次的红**指向的是真问题**，只是指错了 push |
| **把这两个文件的改动挪出当前分支** ← 采用 | 唯一不动任何门控判定、不写假话、不丢工作的做法 |

⚠ **这不是「拿不可信的绿换可推送」**：这 93 条命令**在 phase-02/03 立项之前一次都不会被执行**
（那两个阶段连 sprint 都没有，`claim` 会被签核门直接拒）。补丁在这里等着，
落地时机写死在上表，`lint-verification-can-fail` 会在落地时重新验它们。

相关：`.harness/state/DEBT-phase-02-03-signoff-chain.md`（那条红本身的登记）。
