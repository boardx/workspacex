# verification · canvas-direct-manipulation（迭代 15）

> 编号接 `device-simulation` 的 V71–V77。

## V78 — locate 认得家庭关系，根节点没有父
`apps/web/tests/ui/prototype-node-actions.test.ts`：父 id / 下标 / 兄弟顺序；
root 的 `parent` 为 null；找不到的 id 返回 null。
⚠ 反证：把根也算出一个父 ⇒ 根会变成可删可移，一页就没有根了。

## V79 — 复制去 id，且副本紧跟原节点
同文件 + `design-loop.test.tsx`：`stripIds` 递归去掉整棵子树的 id；
`duplicateOps` 产出 `insert(parentId, index+1, 无 id 的副本)`；根节点返回 null。
⚠ 反证：复制不去 id ⇒ 两个同 id 节点，之后按 id 寻址命中第一个，「改了 A 却看到 B 变」。

## V80 — 移动就是移动一格（把 op 真的应用到树上再看顺序）
`prototype-node-actions.test.ts`：`applyPrototypePatch` 之后 `["a","b","c"]` 下移 a
⇒ `["b","a","c"]`；上移 c ⇒ `["a","c","b"]`；到头返回 null。
⚠ 反证：插入下标写成 `index+2`（"删完之后要补回来"的直觉）⇒ 红。
**只断言 op 的形状会漏掉这个差一格**，所以这条必须真的应用一遍。
⚠ 反证：移动时也去 id ⇒ 「保留 id」那条红。

## V81 — 图层面板摊平带层级
`design-loop.test.tsx`：root 的 `data-depth=0`、它的孩子 =1、卡片的孩子 =2；
点一行就选中（属性面板跟着换）。
⚠ 反证：摊平不带 depth ⇒ 一列平铺，"外面那个容器"仍然分不出来，红（实测）。

## V82 — 键盘四向 + ⌘D + Esc
同文件：→ 走兄弟、↓ 进第一个孩子、↑ 回父；⌘D 发 insert；Esc 清空选中。
`prototype-node-actions.test.ts` 另测走不动时返回 null。
⚠ 反证：走不动返回 undefined 且被当成"取消选中" ⇒ 按一下方向键选中就没了。

## V83 — 输入框里打字时快捷键**不生效**
`design-loop.test.tsx`：从 `design-detail-input` 派发 Delete 与 ⌘D ⇒ 一个 patch 都没发，
选中也还在。
⚠ 反证：不判 target 是不是输入框 ⇒ 红（实测）。
**这是这类快捷键最常见的翻车方式**：用户在对话框里删一个字，节点没了。

## V84 — 预览态不显示图层面板
同文件：切到预览 ⇒ `design-layers` 消失。预览态没有"选中"这回事。

## 未覆盖（如实记）
- **拖拽重排**没做：上移/下移是它的键盘/按钮版本。真正的拖拽要处理放置位置指示、
  跨容器移动、自动滚动，是独立一轮的量，不塞进这轮硬做半个。
- 真浏览器里的快捷键行为无 e2e，理由同 V71 那节（issue #3138）。
