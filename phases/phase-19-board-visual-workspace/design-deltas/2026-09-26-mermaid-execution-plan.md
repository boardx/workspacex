# Board 全量 Mermaid 执行计划

本图是开发和验收导航，不修改 feature 状态、签核或授权。功能和依赖以 `feature_list.json` 为单源；十轮退出指标见 [phase.md](../phase.md)。本次经 `loadFeatureListIn` 读取该设计分支，BV01–BV32 尚无 passing 记录，不能以预览测试或 PR 状态抵扣正式完成。

## 1. 当前交付链与下一步

2026-09-26 GitHub 实时核对：PR4212、4213、4220、4224 均 OPEN；PR4223 已合入 `codex/board-workspace-preview`，不是 main。PR4224 冲突修复为 `e7552403f`，独立复核及 26 项测试通过；新 CI 仍需等待。后续状态以链接对应的实时 PR 为准。

```mermaid
flowchart TD
  P["预览壳 PR4220：OPEN"]:::reviewed
  S["便利贴 PR4223：已进入预览分支"]:::reviewed --> P
  L["标签与复制 PR4224：冲突已修复<br/>局部验收通过，新 CI 待完成"]:::checking --> P
  P --> D["UI / 用例 / API 设计确认<br/>保留待签核边界"]:::pending
  Y["协作 PR4212：OPEN"]:::reviewed --> F["正式 Fabric PR4213：OPEN"]:::reviewed
  D --> I["接入正式浏览入口与全屏底部工具栏"]:::todo
  F --> I
  I --> V["主 session：真实账号、API、PG、Yjs<br/>刷新、双客户端、权限失败路径"]:::todo
  B["存储设计已复核<br/>内容文件或对象存储；PG 元数据"]:::pending --> V
  A["标签与复制 API 候选已复核<br/>撤权、幂等、引用重映射、GC pin"]:::pending --> I
  V --> Q["全量十轮退出门与九分总验收"]:::todo
  classDef reviewed fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef checking fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef pending fill:#ffedd5,stroke:#ea580c,color:#7c2d12
  classDef todo fill:#f1f5f9,stroke:#94a3b8,color:#334155
```

蓝色＝已有实现或局部证据；黄色＝检查待完成；橙色＝设计材料及签核边界；灰色＝正式实现或验收待完成。绿色只留给完整验收通过且符合仓库完成定义的能力，本图没有绿色节点。

## 2. 十轮全量范围与真实依赖

下图边由 `loadFeatureListIn` 的 `depends_on` 生成，分组来自既有 wave。轮次表示验收组织，不把所有轮次强行串成一条线。不同轮次中无依赖且不触碰相同文件的工作可以提前并行；不得修改既有依赖来追求并行数量。

<!-- dependency-graph:start -->
```mermaid
flowchart TD
  subgraph W1["1. Fabric"]
    BV01["BV01 全屏 Fabric 主画布与无限 viewport"]
    BV02["BV02 Yjs 到 Fabric 的增量对象投影注册表"]
    BV03["BV03 Fabric 手势命令桥、回声抑制与对象大纲"]
  end
  subgraph W2["2. Sticky / Text"]
    BV04["BV04 Sticky 与 Text 直接编辑和三种尺寸模式"]
    BV05["BV05 连续便利贴、删除与基础 Undo/Redo"]
    BV06["BV06 Sticky 属性、Reaction 与 Link Preview"]
  end
  subgraph W3["3. Objects"]
    BV07["BV07 Tile、Web Tile、Table 与 Template 对象"]
    BV08["BV08 基础 Shape、独立 Icon 与文字样式"]
    BV09["BV09 矢量自由绘制与可编辑 stroke"]
    BV10["BV10 图片四入口创建与失败占位恢复"]
  end
  subgraph W4["4. Structure / Connector"]
    BV11["BV11 Panel/Frame 三模式与稳定 membership"]
    BV12["BV12 Group、Layer、Lock 与 stacking order"]
    BV13["BV13 独立 Connector、锚点、路由与 label"]
  end
  subgraph W5["5. Selection"]
    BV14["BV14 单选、多选、框选与稳定变换"]
    BV15["BV15 复制粘贴、快速复制与键盘生产力"]
    BV16["BV16 对象感知的浮动工具条与属性面板"]
  end
  subgraph W6["6. Layout"]
    BV17["BV17 原子对齐、分布、统一尺寸与行列网格"]
    BV18["BV18 Snap、Guidelines 与等间距反馈"]
    BV19["BV19 Smart Layout 确定性预览与冲突确认"]
  end
  subgraph W7["7. Collaboration"]
    BV20["BV20 Fabric presence、远端选区与字段级收敛"]
    BV21["BV21 对象锚定评论、回复与解决"]
    BV22["BV22 多人 Undo 语义、认证 tombstone、离线与 checkpoint 恢复"]
  end
  subgraph W8["8. API / AI / Chat"]
    BV23["BV23 统一 operation API 与 Board Event Model"]
    BV24["BV24 AI proposal/diff、确认、provenance 与撤销"]
    BV25["BV25 Chat Mermaid/Fabric 点击时布局原样插入 Board"]
  end
  subgraph W9["9. Storage / Import / Room"]
    BV26["BV26 文件/对象存储正文与 PG 元数据生命周期"]
    BV27["BV27 Miro/Mural 可核对导入与标准导出"]
    BV28["BV28 会议室 presenter viewport 与参与者跟随"]
  end
  subgraph W10["10. Quality"]
    BV29["BV29 真实 1k/5k/10k Fabric/Yjs 性能门"]
    BV30["BV30 50 浏览器长时协作、撤权与灾备恢复门"]
    BV31["BV31 键盘、屏幕阅读器、触控与 400% reflow"]
    BV32["BV32 六条 PRD 旅程与 Mural 九分总门禁"]
  end
  BV01 --> BV02
  BV02 --> BV03
  BV03 --> BV04
  BV04 --> BV05
  BV04 --> BV06
  BV04 --> BV07
  BV04 --> BV08
  BV03 --> BV09
  BV03 --> BV10
  BV07 --> BV11
  BV08 --> BV11
  BV11 --> BV12
  BV11 --> BV13
  BV12 --> BV14
  BV14 --> BV15
  BV14 --> BV16
  BV14 --> BV17
  BV13 --> BV17
  BV14 --> BV18
  BV17 --> BV19
  BV18 --> BV19
  BV03 --> BV20
  BV14 --> BV20
  BV20 --> BV21
  BV20 --> BV22
  BV22 --> BV23
  BV19 --> BV24
  BV23 --> BV24
  BV13 --> BV25
  BV23 --> BV25
  BV22 --> BV26
  BV23 --> BV26
  BV13 --> BV27
  BV23 --> BV27
  BV26 --> BV27
  BV20 --> BV28
  BV22 --> BV28
  BV27 --> BV29
  BV22 --> BV30
  BV26 --> BV30
  BV28 --> BV30
  BV03 --> BV31
  BV21 --> BV31
  BV24 --> BV32
  BV25 --> BV32
  BV27 --> BV32
  BV29 --> BV32
  BV30 --> BV32
  BV31 --> BV32
  classDef backlog fill:#f1f5f9,stroke:#94a3b8,color:#334155
  class BV01,BV02,BV03,BV04,BV05,BV06,BV07,BV08,BV09,BV10,BV11,BV12,BV13,BV14,BV15,BV16,BV17,BV18,BV19,BV20,BV21,BV22,BV23,BV24,BV25,BV26,BV27,BV28,BV29,BV30,BV31,BV32 backlog
```
<!-- dependency-graph:end -->

## 3. 三条开发通道，主会话统一验收

| 通道 | 工作边界 | 并行条件 |
|---|---|---|
| Worker A：浏览与前端工具 | 浏览页、标签菜单、工具子模块、局部交互与组件测试 | 共享 canvas、selection、command adapter 由一个 owner 串行维护；其他 worker 通过稳定接口接入 |
| Worker B：领域与协作 | canonical command、Yjs、Undo、引用关系、对象协议 | 先交付共享接口；一个 owner 同时只领一个 feature；禁止第二套 Fabric JSON 写模型 |
| Worker C：存储与外部集成 | blob adapter、迁移、导入转换、API/AI/Chat/会议室独立模块 | 满足图中依赖和签核后实施；存储 schema、copy/GC 共用协议不可多人同时改 |
| 主 session | 合并到本地验收分支、真实浏览器/API/DB/WS、Docker、性能与恢复验收 | 收齐一批子任务后集中测试；不让子 agent 启动完整环境或代做端到端验收 |

子 agent 交付 exact SHA、所改文件、组件/单元测试和复现步骤。独立 reviewer 不代替主 session 的真实链路验收。每个 feature 一个 issue/PR，失败退回对应 owner 修复；没有明确授权不合并 GitHub PR。

## 4. 下一批执行顺序

1. 收尾 PR4224 修复后的 CI，保留已验收预览；不要重复开发 PR4212/4213 的 host、transport 和投影。
2. 将已审 UI、[标签/复制 API 候选](./2026-09-26-library-api-design.md)及 [存储方案](./2026-09-26-storage-integration-acceptance.md)纳入对应契约束及一致性复核。候选设计不等于已签核的可执行 schema。
3. 正式接入时先打通浏览列表、创建返回真实 ID、动态路由、全屏返回与底部工具栏；再沿依赖推进 Sticky、Shape、Draw、Connector。保留创建重试的 requestId 和服务端权限。
4. 收齐并行实现后，主 session 按 [正式集成矩阵](./2026-09-26-workspace-acceptance-matrix.md)验收。存储单独按其故障矩阵验证，不能用 PG 正文持久化代替文件/对象存储目标。
5. 保留所有后续范围：批量布局、Undo/Redo、离线恢复、API/AI、Chat Mermaid/Fabric 插入、Miro/Mural 导入、会议室、性能、无障碍和灾备。按 phase 原定阈值执行 BV32，不降低门槛。

## 5. 九分判定

不以 PR 数、单元测试数或截图打分。九分必须由正式入口的完整用户旅程、协作与刷新恢复、真实迁移板和性能/可访问性证据支撑。便利贴还需原生 IME、实体触摸、批量操作和完整撤销重做；现有长文本及只读预览验收只证明其记录的局部行为。
