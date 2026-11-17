# 执行计划 — A5 — 原型真实版本引用

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：提供当前项目已关联、当前 owner 可读的真实 Design 原型版本选择器，向父级返回实际 ID 与摘要。
- **完成判据**：独立 helper 与组件测试覆盖权限、失败/空态、只读、切项目/身份及真实版本确认；父级获得集成说明。
- **不做什么**：不更改后端契约、权限、Chat/Design 引擎或父级 stage/snapshot；不部署、merge、GitHub 外发或冒签。
- **假设与待确认**：root 统一 init；现有 listMyProjects 仅 owner，可选范围收窄为关联资源与 owner 列表交集；非 owner 不扩大权限。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：提供真实原型版本引用])
  S1[1. 核对授权与仓库规则]
  S2[2. 核对资源关联与版本契约]
  S3[3. 实现独立读取器和选择器]
  S4[4. 验证权限与异步边界]
  S5[5. 提交并交接父级接入]
  S6[6. 实现引用持久化与冻结版本ID]
  S7[7. 验证报告兼容与历史边界]
  S8[8. 隔离纯格式化与API依赖]

  G --> S1 --> S2 --> S3 --> S4 --> S5
  S5 --> S6 --> S7
  S7 --> S8

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G done
  class S1 done
  class S2 done
  class S3 tested
  %% evidence S3: targeted-tests.log: 19 helper/component tests passed; eslint exit 0
  class S4 tested
  %% evidence S4: isolation-tests.log: module boundary and compatibility tests passed
  class S5 done
  class S6 tested
  %% evidence S6: reference-persistence-tests.log: canonical StageContent roundtrip, frozen v1 while S5 v2, legacy schema and ID comparison passed
  class S7 tested
  class S8 tested
  %% evidence S8: pure-formatting-tests.log: 65 passed including runtime poison of api-client, native adapter and contracts barrel; pure-formatting-eslint.log exit 0
  %% evidence S7: reference-persistence-tests.log: 64 tests passed across 10 files; reference-eslint.log exit 0
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-16 | G, S1 | todo → doing | 接到目标，开始理解 |
