# 契约束 `design-prototype` — 支撑材料：领域模型

> 覆盖 feature：**B5.3**（权威是 `design-signoff.md` frontmatter `covers:`）。

## 1. 实体：本束不新增实体，给 `DesignProject` 加一个字段

| 实体（所属束） | 本束加的字段 | 类型 |
|---|---|---|
| 设计项目 `DesignProject`（`design-workbench`） | `prototype` | `PrototypeNode[]`，`prototype[i]` 是 `frames[i]` 那一页的树 |

值对象（声明在 `packages/contracts/src/design-prototype.ts`，只此一份）：

- **`PrototypeNode`**：递归组件树。容器 `stack`/`card` 有 `children`；其余 11 种是叶子。
  每种类型的 `props` 都是 `.strict()` 对象——模型编造的属性进不了库。
- **`PrototypeScreen`**：`{frame, root}`，模型写回的单位（一页一个对象）。
- **`DesignPrototypeWriteback`**：`PrototypeScreen[]`，1–20 页，给出即整体替换。

## 2. 不变量（能写成断言的）

- **I-8 位置对应。** `prototype.length ∈ {0, frames.length}`；`prototype[i]` 属于 `frames[i]`。
  契约 `DesignProject.superRefine` + 仓储 `update` 的 CASE（只改 `frames` ⇒ `prototype := []`）
  + 读出时 `toPrototype` 长度不等 ⇒ 按「还没生成」处理。三处都守，任一处漏了另两处兜底。
- **I-9 整页原子。** `prototype` 写回时 `frames`（标签）与 `prototype`（树）在**同一条** UPDATE
  里更新；不存在「标签是新的、树是旧的」中间态。`applied` 同时列 `frames` 与 `prototype`。
- **I-10 字段级拒绝。** 任一页超限（深度 > 8 / 节点 > 300）或有非法节点 ⇒ **整个** `prototype`
  字段不写（`parseWriteback` 逐字段判，粒度是字段不是页）；`problem`/`criteria` 照写。
  半套原型比没有更糟——页数对不上 I-8 也守不住。
- **I-11 只经契约 patch 写回，永远重验。**（迭代 5 改写；原文「只能经模型写回」）写 `prototype` 只有两条路：
  模型写回（`appendProjectChat`）与人直接改（`patchPrototype`），两条都走 `applyPrototypePatch` / 整页契约重验，
  `createProject`/`updateProject` 仍不收它，新建恒为 `[]`。
- **I-19 说明与标签同命。**（迭代 8）`frameNotes[i]` 属于 `frames[i]`；只改标签 ⇒ 清空（同 `prototype`）；随版本快照并在恢复时一起写回。
- **I-18 修复至多一轮。**（迭代 7）被拒的只可能是 `prototype`/`patch`，修复轮把契约原话理由喂回去、只发一次；
  纠偏只修机械格式（不猜缺失必填、不删未知键）。用户取消只是前端放弃等待，服务端不回滚。
- **I-17 容器闭集单源。**（迭代 6）有 `children` 的类型只在 `PROTOTYPE_CONTAINER_TYPES` 声明一次，所有遍历（度量 / 补 id / patch / 路径 / 大纲）只认 `isPrototypeContainer`。
- **I-12 原语说明单源。** `DESIGN_CHAT_SYSTEM_PROMPT` 拼 `PROTOTYPE_SCHEMA_GUIDE`，不另抄；
  契约测试断言闭集里每个类型名都出现在说明里。

- **I-13 节点 id 项目内唯一、落库必有。**（迭代 1）`ensurePrototypeIds` 在每次写回前补齐缺失 id、
  保留已有；`prototypeIdsUnique` 是落库不变量。迭代 1 之前的存量树在读出时按遍历序确定性补 id。
- **I-14 patch 整批原子、结果重验。**（迭代 1）`applyPrototypePatch` 顺序执行，每步结果重新过
  `PrototypeNode` 契约与整页上限；任一步失败整批不生效、`applied` 不含 `prototype`。没有原型时 patch 拒。
  `prototype`（整页）与 `patch` 同时给出以 `prototype` 为准。

- **I-15 焦点只是提示，不是权限。**（迭代 2）`focusNodeId` 只影响模型看到的上下文；服务端不校验模型
  的 patch 是否真的落在焦点节点上，也不因 id 失效而拒绝请求（找不到 ⇒ 当没选）。

- **I-16 版本只追加。**（迭代 3）`design_project_prototype_versions` 有 append-only 触发器；「恢复」是把旧版
  内容写回项目再追加一条 `restore` 版本，任何时刻列表都是完整的时间线。版本只在 `prototype` 真的变了时产生。

## 3. 取舍

| 问题 | 选 | 不选 | 为什么 |
|---|---|---|---|
| 画布载体 | 结构化组件树 | 单文件 HTML | 人类 2026-09-06 决定。树可校验、用真实 token 渲染、不需要 iframe 沙箱；增量修改在树上是节点级替换 |
| 本轮范围 | 整页重生成 | 节点级 patch | 人类决定「先整页、后增量」。现在给节点加 `id` 只会是没有生产者的字段 |
| 标签与树 | `frames` 不动，`prototype` 按位置对应 | 把标签塞进树 / 用树派生标签 | 标签是 B4 起的既有事实源；派生会造第二份副本 |
| 导出设计文档 | 客户端纯函数拼 Markdown 下载 | 服务端接口 | 素材全在 `DesignProject`；树的原始 JSON 由实体承载，文档里是缩进大纲不是 dump |
| 超时 | 90s | 保持 30s | 多页 JSON 输出，实测 30s 不够；失败仍退固定回执 |
| 存量数据 | 默认 `[]`，不回填 | 迁移时生成 | 生成要调模型，迁移里调模型是把不可重放的东西放进 DDL |

## 4. 迭代路线（2026-09-06 人类指令：连续迭代到接近 Claude Design）

- ✅ 迭代 1：节点 `id` + `PrototypePatchOp`（setProps / replace / insert / remove），模型可局部改。
- ✅ 迭代 2：画布选中态 + `focusNodeId`——「就改这一块」的对话上下文。
- ✅ 迭代 3：版本历史（append-only 快照；预览 / 恢复；恢复也是一版）。
- ✅ 迭代 4：多画板画布（并排 / 平移缩放 / 聚焦），单页视图保留。
- ✅ 迭代 5：直接编辑（属性面板 setProps / 删除），与模型同一条写回路径，记 `user` 版本。
- ✅ 迭代 6：原语 13 → 21 + 设备尺寸由模板派生（主题不做，理由见 V21）。
- ✅ 迭代 7：生成体验（纠偏 + 一轮修复 / 取消 / 重试 / 已等待时长）。
- ✅ 迭代 8：每页交互说明 + 导出菜单（md / json / png / 复制）。
- 流式生成 / 取消。
