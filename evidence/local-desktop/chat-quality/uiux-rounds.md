# 结果呈现对标 Claude Code / Codex —— 十轮 UIUX 迭代

人类交办（2026-09-23）：聊天与 Claude Code / Codex 差距巨大，**特别是呈现结果的时候**；
要「在右边可以打开结果、浏览网页」，「可以拖拽边界」，review 整个 UIUX，每轮找出 10 个问题再迭代。

## 开工前的实测基线（不是印象，是 grep 出来的）

| 事实 | 证据 |
|---|---|
| 右栏只有两档写死宽度 | `chat-task-inspector.tsx`：`collapsed ? "w-10" : "w-72"` |
| 全壳**一处拖拽都没有** | `grep -c "onPointerDown\|resize"` 在 `components/shell`、`chat-task-inspector.tsx` 下均为 **0** |
| 结果在**模态**里开 | 产物点击 → `ChatArtifactPreviewDialog`（`chat-read-screen.tsx:631`），开着就没法边看边问 |
| 全局壳左右栏同样写死 | `app-shell.tsx`：左 `w-panel`(272px)、右 `w-panel-alt`(316px)，且右栏 `hidden … xl:block` |
| 1280px 以下右栏整条消失 | 同上，`xl:block` |
| `/chat` 根本不用全局右栏 | `(v2)/layout.tsx` 只传 `hideTopBar`，没有 `right`/`left` 槽 |

## 第 1 轮：找出的 10 个问题

1. **右栏宽度写死 288px，不能拖**——人类点名的第一件。
2. 宽度不记忆：每次回来都回到 288px。
3. 拖拽若只做鼠标，键盘用户拿不到这件能力。
4. 结果在**模态对话框**里打开，不能边看结果边追问（Claude Code / Codex 的核心差距）。
5. 没有网页查看：`fetch_url` 抓回来的只有文字，原网页打不开。
6. 一次只能看一个结果，没有多结果并列/切换。
7. 产物列表只有一种打开方式，没有「在右栏打开 / 新窗口打开」之分。
8. 全局壳左右栏同样写死，右栏 `hidden xl:block`——1280 以下整条消失。
9. 折叠态 40px 图标条与展开态之间没有中间档，窄屏上要么占 288px 要么只剩图标。
10. 结果视图缺常驻操作条（复制 / 下载 / 在浏览器打开）。

### 本轮交付（问题 1 / 2 / 3）

- `lib/chat-workbench/panel-width.ts`：**判据单源**的纯函数层——夹取（含「不超过半屏」的
  相对上限）、指针→宽度（把方向写进函数，左右栏复用时不会把符号搞反）、按键→宽度、
  读写持久值。放纯函数是因为 jsdom 模拟真实拖拽不可靠，判据落在测不动的那一层就是空转。
- `components/shell/panel-resize-handle.tsx`：WAI-ARIA **window splitter**
  （`role="separator"` + `aria-valuenow/min/max`），鼠标拖、键盘 ←→（Shift 大步）、
  Home/End 到两端、双击或 Enter/Space 回默认宽度。命中区 6px——1px 的把手谁也抓不住。
- `chat-task-inspector.tsx`：展开态宽度改由状态驱动并持久化（`shell.panelWidth.chat-inspector`）。
  默认值 288px 与被它取代的 `w-72` **逐字相等**，不改默认观感，只是让它可动。

边界：折叠态（40px）与移动态**不给**把手——那两档不是「更窄的同一档」，是另一种形态。
初值不在 `useState` 里读 localStorage（SSR 首帧必须两端一致），同 `app-shell` 折叠态的既有做法。

验证：`panel-width` 15 条、把手 5 条、接线 4 条；`apps/web` ui 全量 **3150 passed / 0 failed**。
