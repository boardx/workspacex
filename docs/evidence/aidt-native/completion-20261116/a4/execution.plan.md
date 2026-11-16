# 执行计划 — A4 成员文字讨论状态恢复

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：复现并修复获准 B 范围内的成员 Chat 可用性缺口，保留草稿、真实回执与访问隔离。
- **完成判据**：先失败测试再修复；成员 Chat 定向组件、适配器和导航测试通过，定向 lint 与 diff 检查通过。
- **不做什么**：不改后端契约、AIDT 父组件、人类签核、AI Chat、权限矩阵；不新增通知/未读或语音；不部署、合并或发布 GitHub。
- **假设与待确认**：用户批准的 A+B 沿用；本轮只交付独立 worktree 提交。root 统一运行 init 和整体 typecheck。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：成员 Chat 可靠状态恢复])
  S1[1. 理解目标并确认完成判据]
  S2[2. 复现乱序授权状态缺陷并跑失败测试]
  S3[3. 修复前端状态更新顺序]
  S4[4. 跑验证命令留证据]
  S5[5. 收尾：本地提交与限制交接]
  S6[6. 交叉审阅配置入口并复现旧404错误]
  S7[7. 补修旧错误并验证当前404隔离]
  S8[8. 提供真实文字浏览器验收helper及调用契约]

  G --> S1 --> S2 --> S3 --> S4 --> S5
  S5 --> S6 --> S7
  S7 --> S8

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: before.log: 4个新反例失败/21个既有测试通过，after-controller.log:25通过
  class S3 tested
  %% evidence S3: after.log:55/55通过，lint.log:eslint退出0，无UI或契约变更
  class S4 tested
  %% evidence S4: after.log:5文件55测试通过；eslint与git diff --check退出0
  class S5 done
  class S6 tested
  %% evidence S6: stale-error-before.log:两反例失败；README记录A1无密钥独立接线检查4项通过
  class S7 tested
  class S8 done
  %% evidence S7: stale-error-after.log:59/59；含当前404隐藏缓存和禁止发送的反向验证
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-16 | G, S1 | todo → doing | 接到 A4 明确分工，阅读根规则与 mod-chat 技能 |
