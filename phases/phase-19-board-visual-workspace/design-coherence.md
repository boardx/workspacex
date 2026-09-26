---
phase: "19"
covers_bundles: [board-fabric-surface, board-object-authoring]
status: pending
confirmed_by: ""
confirmed_at: ""
confirmed_via: ""
---

# Phase 19 阶段一致性复核

> S01 `board-fabric-surface` 曾由人类单独确认。此次把 S02
> `board-object-authoring` 加入同一复核面，复核范围已变化，因此阶段一致性状态重新回到
> `pending`。这不撤销 S01 束自己的签核，也不表示 S02 已签核；只有人类可以确认这份扩展后的
> 跨束复核并填写 frontmatter。

## 复核范围

| 束 | feature | 本束增加的能力 | 与另一束共享的边界 |
|---|---|---|---|
| `board-fabric-surface` | BV01–BV03 | Fabric 主表面、Yjs 增量 projection、viewport、selection、gesture bridge、DOM a11y mirror | object id/order、command 入口、readOnly、projection guard、world coordinates |
| `board-object-authoring` | BV04–BV06 | Sticky/Text 创作、IME/连续创建、presentation、Delete/基础 Undo/Redo、Reaction、Link Preview | 同一 Fabric registry、selection、Yjs transaction、DOM mirror、ACL 与错误表面 |

本次逐项读过两束的 `ui.md`、`usecases.md`、`domain.md`、`coverage.md`、
`design-signoff.md`，并以 ADR-100、ADR-115、阶段需求和 Phase 19 架构边界为约束。
下表的“材料结论”只说明两份设计是否互相矛盾；右侧人类核对框仍为空，不能由 agent 的文档
复核替代设计签核。

## 跨束结论总表

| # | 复核项 | 材料结论 | 人类核对 |
|---|---|---|---|
| XC-01 | canonical model 与 Fabric projection | 一致 | [ ] |
| XC-02 | object identity、selection 与 order | 一致 | [ ] |
| XC-03 | command、transaction 与 Undo 边界 | 一致，协作历史范围需保持后续束边界 | [ ] |
| XC-04 | DOM mirror 与 readOnly | 一致 | [ ] |
| XC-05 | IME、连续创作、viewport 与 24px 坐标 | 一致 | [ ] |
| XC-06 | Reaction 与 Link Preview 安全 | 一致，Commenter 权限仍待人类裁决 | [ ] |
| XC-07 | 错误状态与恢复粒度 | 一致 | [ ] |
| XC-08 | preview/mock 与正式实现证据 | 一致，当前材料不证明正式服务 | [ ] |

## XC-01 · Yjs / `whiteboard-core` 仍是唯一事实源

- [ ] 两束都把对象内容、文本、几何、样式、顺序、tombstone、reaction 和 link 状态写入
  canonical Board/Yjs model；Fabric、React editor 与 DOM mirror 都只是可丢弃 projection。
- [ ] S02 的 Sticky/Text、`CollaborativeText`、`ObjectReaction`、`ObjectLink` 和 history item
  是对同一 Board object 判别联合的扩展，不建立第二个 authoring document。
- [ ] Fabric `toJSON/loadFromJSON`、Fabric class/instance/scale、React draft、preview HTML 不进入
  Yjs、PG、blob/file、checkpoint、history、公开 API 或恢复包。
- [ ] 本地 command 与远端 update 最终都由 S01 的 Yjs observer 投影；创建成功、删除成功、
  Undo/Redo 成功不得早于 canonical transaction 接纳和 observer projection。

**材料结论：一致。** S02 明确复用 S01 `dispatchBoardCommand`，文本以 splice/CRDT 提交，
Delete 以 tombstone 表达，恢复不依赖 Fabric JSON；这符合 ADR-115。实现阶段仍需静态扫描与
round-trip 反证，设计一致不等于实现已经成立。

## XC-02 · object identity、selection 与 stacking order 只有一套

- [ ] `Y.Map key == BoardObject.id == Fabric data.boardObjectId == DOM mirror key == history target`。
- [ ] S02 创建时先得到 canonical stable id，再经 observer 加入 S01 registry；不得先创建临时
  Fabric 业务对象、之后换 id。
- [ ] Sticky/Text、Reaction/Link 汇总、inline editor、属性面板和 history 都引用相同 object id；
  不使用 Fabric 数组下标、DOM id 或 reaction 节点作为业务身份。
- [ ] stacking `orderKey` 仍由 Board canonical model 持有；连续 Sticky 的创建顺序和 DOM mirror
  顺序使用同一 projection，不因局部 React render 另排一套顺序。
- [ ] Fabric selection、属性面板、inline editor 与 DOM mirror 共享 S01 `BoardSelection`；远端
  tombstone 后统一清理 selection、结束 editor，并把焦点迁移到可用对象或 Board 根。

**材料结论：一致。** S02 没有增加 selection store 或 order 权威；Reaction summary、Link Preview
和 editor overlay 均从同一对象投影。后续实现需证明 Undo 恢复原 id 且顺序/focus 同步。

## XC-03 · command、transaction 与 Undo 边界

- [ ] S01 的 Fabric gesture、S02 的 inline editor/toolbar/快捷键/DOM mirror，以及未来 AI、API、
  importer 都调用 `whiteboard-core` 的同一 command 入口，不直接写 Fabric 或 Y.Map。
- [ ] 一次完整 gesture、一次已结束 IME composition、一次 presentation/reaction/link 修改各形成
  有界语义 command；projection guard 只抑制回声，不吞掉下一次真实输入。
- [ ] 500 张 bulk Sticky 是一个原子 transaction 和一个 history item；失败时 0 张落地。
- [ ] Iteration 2 的基础 history 只覆盖当前在线 create/text/style/move/delete；Delete Undo 安全时
  恢复同一 id，遇到 foreign revision、撤权或不可恢复 tombstone 时拒绝且 cursor 不移动。
- [ ] 多客户端 causal Undo、离线 outbox、认证 restore 和 checkpoint 恢复仍属于 BV22；S02 不以
  基础 Undo 的设计或 mock feedback 提前宣称这些能力。

**材料结论：一致且范围闭合。** S02 的 history inverse 保存领域命令，不保存 Fabric object。
S01 的幂等 gesture/transaction 边界继续成立；后续协作束只能扩展 causal policy，不能另建 history
事实源或强制覆盖他人写入。

## XC-04 · DOM accessibility mirror 与 readOnly

- [ ] inline editor 可以是短生命周期 React DOM overlay，但 canonical text 仍是 collaborative
  text/splice；overlay 卸载后必须可从 Y.Doc 无损重建。
- [ ] DOM mirror 继续读取同一 projection、selection、order 与 accessible name；其编辑、删除、
  reaction 和 undo 入口发送同一 Board command。
- [ ] Viewer 可 pan/zoom/选择/阅读并打开安全链接，但 Fabric controls、Sticky/Text 工具、inline
  editor 写态、Delete、Undo/Redo、Reaction 与属性 mutation 均不可写。
- [ ] Commenter 在当前 S02 契约中也不能做对象 mutation 或 Reaction；若人类决定放开 Reaction，
  必须作为 ACL design delta 同时落实 canonical command 与服务端校验，不能只启用按钮。
- [ ] 撤权或远端删除立即结束编辑，保留可复制但不回写的 draft，焦点安全迁移；键盘和 DOM
  入口不得绕过 readOnly。

**材料结论：一致。** S02 扩展了 S01 的 mirror 交互语义，没有把 DOM 变成第二主渲染面或权限
旁路。Commenter Reaction 是明确的人类裁决点，未被预览默认值暗中决定。

## XC-05 · IME、viewport、world coordinates 与 24px 连续间距

- [ ] `compositionstart` 到 `compositionend` 期间产生 0 splice、0 下一张 Sticky、0 history item；
  composition 结束后最多一个语义文本 history item。
- [ ] `Tab` 连续创建先完成当前 composition，再创建下一张并聚焦；`Shift+Tab` 保持焦点导航，
  不暗中反向创建。
- [ ] 连续 Sticky 默认横向，只有明确纵向序列才纵向；对象边缘间距固定 **24 world-space px**，
  而非屏幕像素或 Fabric scaled width。
- [ ] zoom 0.05 / 1 / 8 下得到相同 canonical geometry；pan/zoom/fit 是 S01 本地 viewport，
  不进入 authoring command、Y.Doc、history 或远端客户端视图。
- [ ] auto-height 由版本化 canonical text/style 测量规则得到提交后的 world geometry；Fabric scale
  与当前 device pixel ratio 不成为尺寸事实。

**材料结论：一致。** S02 的 24px 与 resize 规则明确建立在 S01 world coordinates 上，未把
viewport 写回对象。ADR-100 的“坐标不写回 Mermaid”继续成立；Board 坐标留在 Board canonical
model，Chat/Mermaid 只在导入边界转换一次。

## XC-06 · Reaction 与 Link Preview 的安全边界

- [ ] Reaction 的 canonical identity 是 `(objectId, actorId, emoji)`，summary 是派生 projection；
  DOM emoji/头像、显示顺序和 Fabric decoration 都不是事实源。
- [ ] Link 只接受规范化的 `http/https` URL；异步 preview 结果必须同时匹配 object id 与 link
  revision，迟到结果不得覆盖新 URL。
- [ ] resolver 位于受限服务端 infrastructure，经 application port 只返回 title、description、
  siteName、`imageAssetRef`、fetchedAt 等安全字段；浏览器不直接抓任意 URL。
- [ ] 必须限制 DNS/IP/redirect、scheme、host policy、响应大小、类型与超时，禁止 SSRF；原始
  HTML、脚本、cookies、认证 header、响应体或内网探测细节不进入 Board 或错误提示。
- [ ] `failed/blocked` 保留已确认的安全链接并允许重试/移除，不显示伪造 ready，也不使整个对象
  编辑失败；Viewer 只可打开安全链接，不可改变 link/reaction。

**材料结论：一致。** Link resolver 尚未形成跨进程 DTO；若实现需要 HTTP Preview API，必须先
补 `packages/contracts` zod envelope、ACL、限流和 OpenAPI 消费点并走 design delta。当前预览中的
failed/blocked 外观不能证明 SSRF 防护或正式 resolver 已完成。

## XC-07 · 错误状态保持同一粒度与可恢复语义

- [ ] Board/document 依赖失败继续使用 S01 `BOARD_DEPENDENCY_UNAVAILABLE`，不以旧 Fabric/React
  状态伪装最新内容；单对象 projection fault 只隔离该 id。
- [ ] S02 command invalid、IME incomplete、text conflict、history empty/conflict、link
  invalid/blocked/unavailable、bulk limit 等失败都不写部分 canonical state、不移动 history cursor。
- [ ] readOnly/撤权在所有 Surface 和 authoring 入口使用同一 ACL 结论；未授权错误不泄露对象正文、
  内网策略或 Board 是否存在。
- [ ] context lost 只重建 S01 renderer registry；正在编辑的 S02 内容从 canonical document 与安全
  的短生命周期 draft 恢复，不能用 Fabric JSON 或 editor DOM 覆盖 Y.Doc。
- [ ] 所有成功提示晚于 canonical 确认；失败状态保留明确重试、复制 draft、离开或恢复入口，
  不出现“按钮成功但事实未提交”。

**材料结论：一致。** 两束分别处理 surface、单对象 projection 和 authoring operation 错误，粒度
没有冲突。实现仍须为延迟 observer、远端 tombstone、撤权、旧 preview response 和批量中断提供
失败注入证据。

## XC-08 · S02 preview/mock 不证明正式产品或服务

- [ ] `/preview/board-object-authoring?state=...` 的 8 张截图只证明真实 Fabric 原型的视觉、响应式
  和状态材料；mock command adapter 没有证明 Yjs、ACL、history、Link resolver 或持久化。
- [ ] S02 的完成证据必须来自正式 `/studio/board/:boardId`，复用已签核 S01 surface，并由主
  session 验证真实浏览器、API/服务、Yjs transaction、权限与失败路径。
- [ ] `coverage.md` 中的命令是未来门控入口；“契约闭合”不等于测试文件、服务或行为今天存在。
- [ ] TTFI `<5s` 从 `board-state-ready` 到第一张 caret-ready；连续创建是首张完成后再建 10 张、
  到第 11 张 caret-ready `<30s`。预置对象、mock timer 或截图不能替代正式 trace。
- [ ] 预览中的 readonly、undo-conflict、link-failed 和 composing 只用于人类签核状态设计；正式
  实现必须用可控的真实依赖/冲突/输入法路径重现，且不得把查询参数当权限或服务端状态。

**材料结论：边界披露清楚。** S02 `ui.md` 已明确 mock command adapter 和 24/24 视觉材料只证明
预览质量。此复核不把这些材料升级为 feature evidence，也不允许 BV04–BV06 因截图进入 claim/passing。

## 仍待人类裁决

### S01 已确认且本次不重新发明的边界

1. Fabric 是正式 Board 唯一对象主表面；Yjs/`whiteboard-core` 是 canonical source。
2. S01 不新增公开对象 HTTP CRUD；公开 operation API 在后续专束签核。
3. DOM mirror 是同一 projection 的可访问交互面，不是第二对象模型。
4. 开发期 renderer 对照只消费同一 Y.Doc，正式用户路由最终只保留 Fabric。

### S02 新增裁决

1. Commenter 是否可以添加 Reaction；当前契约为不允许，放开需要 ACL design delta。
2. 空白新 Sticky 在 blur 且文本为空时保留空对象还是产生 tombstone。
3. composition 已结束但 command 尚未确认时按 `Escape`，是等待确认还是提示后退出；两者都不得丢字。
4. Link Preview 的组织级 allow/deny policy 在 V0.1 是否暴露管理 UI，还是仅由平台策略提供。
5. 是否接受 Iteration 2 基础 Undo 的范围止于当前在线 authoring，并把多人 causal Undo、离线与认证
   restore 保留给 BV22。

## 人类确认动作

请先核对 `contracts/board-object-authoring/design-signoff.md` 的 ① UI、② 用例、③ API/协议和四个
束内裁决，再逐项核对本文件 XC-01～XC-08 及五个新增裁决。只有人类可以把本文件 frontmatter
改为 `confirmed` 并填写 `confirmed_by`、`confirmed_at`、`confirmed_via`；当前必须保持 `pending`。
