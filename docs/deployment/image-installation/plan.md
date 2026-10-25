# 执行计划 — 正式镜像消费者安装入口

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：用户已有五个正式镜像，通过一份配置和统一命令完成新机器安装。
- **完成判据**：python3 -m unittest discover -s tests -p test_image_installer.py -v；独立包plan与Compose解析；PR必需门控通过。
- **不做什么**：不部署US、不建Runner、不修改现行image-release、不声称真实主机已验收。
- **假设与待确认**：Ubuntu24.04 x86_64，五个同源镜像，同机数据服务与本地FS，HTTPS。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：正式镜像可操作安装方案])
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

  class G done
  class S1 done
  class S2 done
  class S3 done
  class S4 tested
  %% evidence S4: python3 -m unittest discover -s tests -p test_image_installer.py -v → verification.txt
  class S5 done
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-25 | G, S1 | todo → doing | 接到目标，开始理解 |
