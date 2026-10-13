# 执行计划 — Chat 公开分享

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：聊天生成分享链接，朋友无需账号即可在手机和电脑阅读。
- **完成判据**：API/PG/UI测试与真实匿名手机/桌面浏览器链路通过，PR门控绿。
- **不做什么**：首版整段只读快照，非图片附件不公开字节，不包含实时协作。
- **假设与待确认**：采用整段快照；用户要求直接开发并跳过身份确认。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：免登录对话分享])
  S1[1. 理解目标并确认完成判据]
  S2[2. 勘探现状 / 定位要改的地方]
  S3[3. 快照/API/匿名阅读页实现]
  S4[4. 权限、PG、手机/桌面验证]
  S5[5. PR 与证据交付]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 done
  class S3 tested
  %% evidence S3: API unit/http/UI/browser验证；证据在同目录
  class S4 tested
  %% evidence S4: api-unit.txt/api-http.txt/ui-unit.txt及375/1440截图
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-13 | G, S1 | todo → doing | 接到目标，开始理解 |
