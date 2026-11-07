# 执行计划 — 中国营销主域与登录入口

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：以 workspacex.cn 为中国主域，展示 -2 备案号并修复旧登录入口
- **完成判据**：实际公网首页、旧域与登录、HTTPS、中文、备案、手机通过
- **不做什么**：只限中国营销站；保留版本与美国站
- **假设与待确认**：现有阿里云认证缺失，发布尚未执行

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：中国营销站修复与发布])
  S1[1. 理解目标并确认完成判据]
  S2[2. 勘探现状 / 定位要改的地方]
  S3[3. 实现最小改动]
  S4[4. 跑验证命令留证据]
  S5[5. 收尾：PR / 交接]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G blocked
  %% blocked G: 无阿里云现有认证，未发布；需要为此云环境连接现有账号
  class S1 done
  class S2 done
  class S3 done
  class S4 tested
  %% evidence S4: unit.log / static.log / pages-tests.log / browser.log: 11 + 16 + 25 + 128 通过
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-30T02:47:01.810231+00:00 | G, S1 | todo → doing | 接到目标，开始理解 |
