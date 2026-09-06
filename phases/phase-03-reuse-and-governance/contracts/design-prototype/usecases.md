# 契约束 `design-prototype` — 支撑材料：用例

覆盖 feature：**B5.3**（权威是 `design-signoff.md` frontmatter `covers:`）。

## UC-B5.3 · owner 在设计详情左栏一句话让模型整页生成/重生成原型画布，并可导出设计文档

**主角**：设计项目 owner。**入口**：`/platform-admin/design-workbench/<id>` 左栏「设计协作」。

```
UC: 发一句设计协作消息（B5.2 同一条路径，写回形状扩展）
  in:  POST /pm-designs/:projectId/chat { text }
  out: { project (含 prototype), reply: { source, applied: ("problem"|"criteria"|"frames"|"prototype")[] } }
  pre: 项目存在；请求者是 owner
  err: PROJECT_NOT_FOUND | NOT_PROJECT_OWNER | DEPENDENCY_UNAVAILABLE
```

1. 模型上下文 = B5.2 的五个字段 + **当前 `prototype`**（按页 JSON）+ 本项目完整 `chat[]`。
2. 用户要求设计/画/改界面时，模型输出 `writeback.prototype: {frame, root}[]`（**全部页面**，
   没提到的页原样给回）。服务端拆成 `frames` + `prototype` 一次写入；`applied` 含两者。
3. 只改标签不改内容：模型给 `writeback.frames` ⇒ 标签替换、`prototype` 清空。
4. 画布区按 `prototype[frame]` 渲染组件树；切页看另一页；没树显示占位块 + 引导语。
5. 顶栏「导出设计文档」：客户端把 `DesignProject` 拼成 Markdown（问题与目标 / 验收标准 /
   原型逐页缩进大纲 / 对话摘录）并下载 `<项目名>-<日期>.md`。

**验收线索**
- **V10**：模型给合法 `prototype` ⇒ `project.frames` = 各页标签、`project.prototype` = 各页树，
  `applied` 含 `frames` 与 `prototype`；画布从占位块变成渲染的树，「已更新」列「原型画布」。
- **V11**：切换页标签 ⇒ 画布显示对应页的树（位置对应）。
- **V12**：模型只给 `frames` ⇒ 标签变、`prototype` 为 `[]`、画布回到占位块。
- **V13**：某一页超限或含非法节点 ⇒ `prototype` 不写、`applied` 不含它，其余合法字段照写。
- **V14**：发送中显示「正在生成…」提示；输入框与发送键禁用；超时/失败退回固定回执，
  `source: "fallback"`，`prototype` 不变。
- **V15**：点「导出设计文档」触发一次 `.md` 下载，内容含四节与逐页大纲；没有原型时说明
  页面划分而不是输出空节。

- **V16**（迭代 1）：模型给 `writeback.patch` ⇒ 按 id 局部改并落库、`applied: ["prototype"]`、页标签不变；
  整页写回时模型没写的 id 由服务端补齐，模型下一轮看到每个节点都有 id；未知 id / 删根 / 非法结果 ⇒ 整批拒、其余字段照写。

- **V17**（迭代 2）：点画布节点 ⇒ 描边 + 焦点 chip（标签 + 页 › 路径）；发送请求带 `focusNodeId`，服务端解析成路径喂给模型、模型优先 patch 它；节点被删/整页重生成后 chip 自动消失；找不到的 id 服务端当没选。

- **V18**（迭代 3）：每次 `prototype` 被写回（整页 / patch）追加一条版本快照（来源 model，摘要 = 那轮回复前 120 字）；只改标签不记。列表倒序不带树、单条带树；预览不写库；恢复 = 写回旧版 frames+prototype 并再追加一条 `restore` 版本；非 owner 不能恢复；版本不存在 ⇒ `VERSION_NOT_FOUND`。

- **V19**（迭代 4）：默认画板视图，全部页并排；滚轮平移、Ctrl/⌘+滚轮以指针为中心缩放、空白拖拽、键盘 −/＝/0、右下角按钮与「适应」；点标题/节点聚焦该页；「单页」视图只看当前页；预览态在两种视图下都生效。纯前端，无契约变化。

- **V20**（迭代 5）：owner 选中节点后在属性面板改文案/属性 ⇒ `POST …/prototype/patch { ops:[setProps], summary }`；删除 ⇒ `remove`；服务端 `applyPrototypePatch` 重验、记 `source: user` 版本；未知 id / 删根 / 结果不合法 / 没原型 ⇒ 400 `PROTOTYPE_PATCH_REJECTED` + `detail`，前端原样显示；非 owner ⇒ 403。

**失败模式（穷举，B5.2 的表继续适用，这里只列本束新增）**
| 情况 | 用户可见结果 | 标记 |
|---|---|---|
| `prototype` 某页超限 / 非法节点 / 页数 0 或 > 20 | 画布不变；其余字段照写 | `applied` 不含 `prototype` |
| `prototype` 与 `frames` 同时给出 | 以 `prototype` 为准（自带标签） | `applied: [.., "frames", "prototype"]` |
| 库里 `prototype` 长度 ≠ `frames`（契约演进后旧数据） | 读出按「还没生成」，画布占位块 | — |
| 模型超时（90s） | 固定回执，画布不变 | `source: "fallback"` |
| `patch` 任一条失败 / 还没有原型 | 画布不变；其余字段照写；记日志 | `applied` 不含 `prototype` |
| 人直接改的 patch 失败（迭代 5） | 属性面板红字显示服务端 detail；画布不变 | 400 `PROTOTYPE_PATCH_REJECTED` |
