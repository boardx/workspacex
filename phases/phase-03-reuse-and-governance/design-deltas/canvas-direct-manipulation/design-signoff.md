---
status: confirmed
bundle: canvas-direct-manipulation
base_bundle: design-prototype
scope: layers-duplicate-reorder-keyboard-page-management-undo-patch-guide-coverage
covers: []
confirmed_by: "usamshen"
confirmed_at: "2026-09-09T02:40:00Z"
confirmed_via: "PR #3185"
---

# design delta 签核 · 画布直接操作 + 页管理与撤销（迭代 15 / 16）

⚠ `status`、`confirmed_by`、`confirmed_at`、`confirmed_via` 只能由人类修改；agent 不代签
（ADR-023 / AGENTS.md「设计签核（三件、一处签）」）。本文件由 agent 起草，**status 停在 pending**。

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。
GitHub：PR #3173（迭代 15）、PR #3184（迭代 16）。

## 这份 delta 为什么存在

人类 2026-09-08 交办：「改进用户友好度……朝着 Claude design 的方向迭代」，并授权连做三轮。
同样是**实现先行**（「不要再问我问题」），所以本签核是**追认**。

## ① UI

见 [contract.md](./contract.md) §1、§6、§7、§10。两轮加了七处：

| 迭代 15 | 迭代 16 |
|---|---|
| 图层面板（摊平带缩进） | 页签行的加 / 复制 / 删按钮 |
| 复制节点（⌘D） | 双击页签改名 |
| 上移 / 下移 | 一键撤销 |
| 键盘导航（↑父 ↓子 ←→兄弟，Esc 取消） | |

重点确认：
- 图层面板只读**结构**不读样式（props 细节归属性面板）——够用吗？
- 没有 id 的节点（服务端还没补上）在图层里是**禁用**的，比点了没反应诚实。
- 走不动的方向键**保持原选中**而不是清空——按一下方向键选中就没了，比没反应更让人困惑。

## ② 用例

见 [verification.md](./verification.md) **V78–V90**，重点看这三条：

- **V83 输入框里打字时快捷键不生效**。少了这个判断，用户在对话框里按 Delete
  会把选中的节点删掉，而他只是想删一个字。**这是这类快捷键最常见的翻车方式。**
- **V80 移动就是移动一格**：把 op 真的应用到树上再看顺序。插入下标要按**删除之后**的数组算，
  差一格就变成"下移两格"或"原地不动"——只断言 op 的形状会漏掉这个。
- **V89 撤销回到上一版**：取**倒数第二版**。最后一版就是现在这份，恢复到它等于什么都没发生，
  那是**静默失效**——用户会以为撤销坏了却说不出哪里坏。

## ③ API 契约

对应 `packages/contracts/src/design-prototype.ts`：

1. **不新增 `move` op**（§2）。已有 `remove` + `insert` 按顺序执行就是移动。新增一个 op
   意味着契约、校验、模型 guide、服务端应用逻辑各多一处要维护，换来的只是少写一行。
2. **新增 `renameScreen` op**（§8）。改名此前没有 op，用 `removeScreen` + `addScreen` 拼是
   **错的**：`addScreen` 只带 frame/root/links 会**丢掉这一页的 notes**；`shiftLinkTargets`
   先 -1 再 +1，中间那一步已经把指向本页的跳转改掉了。改名是只动一个字段的操作，
   就该是一个只动一个字段的 op。
3. **复制去 id，移动保留 id**（§3、§9）。id 项目内唯一；带原 id 复制会造出两个同 id 节点，
   按 id 寻址一律命中第一个——表现是「改了 A 却看到 B 变」。
4. **不新增路由、不新增错误码、不动数据库。** 三个入口（面板 / 图层 / 键盘）都走
   `lib/prototype-node-actions` 算 op，再交给同一个 `runNodeOps` → `patchPrototype`，
   与模型写回同一条路径（I-11）。

## 本轮抓到的真洞，请一并确认处置

`PROTOTYPE_PATCH_GUIDE` **从没告诉过模型**有 `addScreen` / `removeScreen`（迭代 12 起，4 轮）
和 `setLinks`（迭代 11 起，5 轮），反而写着「新页面 ⇒ 用 prototype 整页给出」——
**等于教模型为了加一页把所有页重画一遍**，正是「单页超输出预算」那条根因的推手
（迭代 12 花了一整轮做降级重试去兜它）。

处置：新增门控 **V90**——契约里每个 patch op 都必须出现在 guide 里。这条门写出来当场抓到
上面两个洞，不是假想的风险。本仓「没有脚本的规范条目视为未落地」的同一条，
只是这次的使用者是模型。

## 如实记的未覆盖

**拖拽重排没做**——上移/下移是它的键盘/按钮版本。真正的拖拽要处理放置位置指示、
跨容器移动、自动滚动，是独立一轮的量，不塞进这轮硬做半个。

## 请人类拍板的两处取舍

| # | 取舍 | 建议 | 备选 |
|---|---|---|---|
| ① | 移动用 remove+insert 还是新增 `move` op | **A** 复用已有 op（已实现） | B 新增 `move` |
| ② | 改名用 `renameScreen` 还是 remove+add | **A** 新增只动一个字段的 op（已实现） | B 拼两个 op（会丢 notes） |

若与建议不同，把选择写在下面这行，agent 按它改：

> 人类选择：① ＿ ② ＿
