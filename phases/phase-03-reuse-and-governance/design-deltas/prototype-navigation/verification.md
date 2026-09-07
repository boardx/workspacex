# verification · prototype-navigation（迭代 11）

> 每条都写**反证**——把哪一行删掉这条就红。写不出反证的验收线索不算验收线索。

## V26 — 跳转关系是契约的一部分，悬空只丢那一条
`packages/contracts/tests/design-prototype.test.ts`：`links` 目标越界 / 自跳 / `from` 不在本页 /
`item` 越界 / 重复 `(from,item)` 五条，各自只丢那一条、其余 link 与整页保留；`links` 超 30 截断。
⚠ 反证：把 `validateLinks` 改成"任一条不合法 ⇒ 整页拒"，前五条全红（页面本该保留）。
⚠ 反证：把 `to` 的越界判断删掉，第一条红。

## V27 — 整页写回带 `links` 落库并进版本，`setLinks` 与人改走同一条路
`apps/api/tests/design-workbench/project-lifecycle.test.ts`：模型整页给 `links`（节点自带 id）⇒
落库、`applied` 含 `prototype`、版本快照里有 `links`；模型 patch `setLinks` ⇒ 只改那一页的
`links`、记 `model` 版本；属性面板 `POST …/prototype/patch { ops:[setLinks] }` ⇒ 记 `user` 版本；
`setLinks` 指向不存在的页 ⇒ 那条被丢、其余生效（非拒）。
⚠ 反证：`setLinks` 不经 `validateLinks` 直接写，"指向不存在的页"那条红。

## V28 — 存储：恢复旧版把 `links` 一起写回（按 §5 选 A 时：单列 `screens`，无长度不变量）
同文件：写两版（第二版多一条 link）→ 恢复 v1 ⇒ 当前项目的 `links` 回到 v1 的样子。
若人类选 B（第四列）：加一条「只写 `frames` 且等长 ⇒ `frame_links` 保留；不等长 ⇒ 清」——
与 #2900 修的 `prototype`/`frame_notes` 同一形状。
⚠ 反证（选 A）：迁移脚本漏合 `frame_notes` 进 `screens`，既有项目恢复后 `notes` 全空。

## V29 — 预览模式：点有 link 的节点真的换页，没 link 的不动
`apps/web/tests/ui/design-loop.test.tsx`：切「预览」⇒ 属性面板与焦点 chip 消失；单页视图点
带 link 的按钮 ⇒ `design-detail-frame-{to}` 变 active、画布渲染目标页的树；点没 link 的节点 ⇒
页不变、也**不**触发选中；切回「编辑」⇒ 点节点恢复选中语义。
⚠ 反证：预览模式下把 `onSelect` 照旧传进画布，"没 link 的节点"那条红（它会被选中）。

## V30 — 画板连线数量与 link 数一致，随 links 变化
同文件：画板视图 `design-detail-board-links` 里 `<path>` 数量 == 合法 link 数；`setLinks`
应用后数量随之变；没有 link 的项目不渲染这一层。
⚠ 反证：连线按 `frames.length - 1` 画"相邻页连线"（看起来也像流程图），这条红。

## V31 — 属性面板给跳转目标，发的是 `setLinks`
同文件：选中 `button` ⇒ 面板出现「点击后跳转到」下拉（各页 + 无）；选一页并应用 ⇒ 请求体是
`{ ops:[{op:"setLinks", screen, links:[…含这条…]}] }`；选中 `bottomnav` ⇒ 按项各一个下拉。
⚠ 反证：面板发 `setProps { goTo }`，契约 `.strict()` 直接拒——这条红且说明方案 A 的成本在哪。

## V32 — 模型说明里有 `links` 与 `setLinks`，few-shot 示例里有一条真连线
`packages/contracts/tests/design-prototype.test.ts` + `apps/api/tests/design-workbench/design-chat-model.test.ts`：
`PROTOTYPE_SCHEMA_GUIDE` 含 `links`、`PROTOTYPE_PATCH_GUIDE` 含 `setLinks`、`DESIGN_FEW_SHOT`
的示例 1 含 `"links"`；设计原则含「去处」。
⚠ 反证：模型从没见过 `links` 这个词，永远不会连线——功能"存在"但没有生产者。

## V33 — 导出：设计文档每页有「跳转」小节，JSON 规格带 `links`
`apps/web/tests/ui/design-doc-markdown.test.ts`：有 link 的页输出 `按钮「发送」 → 第 2 页「对话」`；
没 link 的页不出这一节；`buildPrototypeSpecJson` 的 `screens[i].links` 原样带出。

## V34 — 真浏览器主链路
`apps/web/e2e/design-prototype-loop.spec.ts` 加一条：夹具项目自带 links → 切预览 → 点「开始新对话」
⇒ 页签切到「对话」、画布换树 → 画板视图能数出 3 条连线 → 切回编辑，选中同一按钮，面板显示
它当前指向「对话」。
⚠ 不断言真实模型会不会连线——那属于 `real-model-e2e.md` 那条 lane，本 delta 的夹具连线是手写的。

## V35 — 截图材料（签核第 ① 件）
`ui-preview/design-prototype/` 新增：`detail-prototype-preview-dark.png`（预览模式，hover 在带
link 的按钮上）、`detail-prototype-links-dark.png`（画板视图三页 + 连线）、
`detail-prototype-inspector-link-dark.png`（属性面板「点击后跳转到」）。`ui.md` 引用集合 ==
实存集合（`lint-ui-material`）。
