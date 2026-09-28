# WorkspaceX 整体 UIUX 重构 — 三轮迭代原型

> 定位变化：**用户在看 AI 聊天和执行日志 → 用户在管理一个由 AI 完成的工作。**
> 结构：`Conversation → Task → Artifact → Next Action`；三栏 = 左 Where am I / 中 What am I doing / 右 What supports this work。
>
> 这是**设计原型**（纯静态 HTML，浏览器直接打开），供束级 `design-signoff.md` 第 ① 件（UI）签核前评审用；
> 不改 `apps/web` 生产代码。色值镜像自 `apps/web/app/globals.css` 的 token，不另立事实源。

| 版本 | 文件 | 截图 |
|---|---|---|
| v1 结构 | `v1.html` | `shots/v1-1440.png` |
| v2 层级 | `v2.html` | `shots/v2-1440.png`、`shots/v2-run-1-1440.png`（展开执行过程） |
| v3 工作空间 | `v3.html` | `shots/v3-1440.png`、`v3-run-1-menu-1-1440.png`（执行过程 + `/` 指令）、`v3-k-1-1440.png`（⌘K）、`v3-theme-dark-1440.png`、`v3-insp-1-1100.png`（窄屏 Inspector 抽屉）、`v3-390.png`（手机） |

v3 URL 参数可直接复现各状态：`?run=1`、`?menu=1`、`?k=1`、`?insp=1`、`?theme=dark`。

## 迭代 1 — 先把信息架构立起来

做了什么：三栏分工；左栏收敛为 8 个高频对象 + 空间 + 最近对话；执行过程压成「✓ 已完成 · 4m32s · 23 个动作」；
产出物做成独立卡片带 预览/下载/代码；右栏改成 任务｜文件｜知识｜相关 四个 Tab。

自评问题（驱动 v2）：
1. 仍然处处是 1px 边框——所有卡片同一层级，没有前景/背景。
2. 执行步骤默认全部展开，只是换了个位置的日志。
3. Artifact 卡片只是「一行文件名 + 按钮」，没有预览，不像一等公民。
4. 右栏 Tab 是装饰，不能切换；左栏「工具 / 社区」仍是功能目录。

## 迭代 2 — 用空间和排版建立层级，渐进披露

- 四级层次：L0 应用底 `#F4F4F1` → L1 工作面（中栏浮起的圆角 surface）→ L2 卡片（阴影代替边框）→ L3 主动作（唯一的黑色实心按钮「打开」）。
- 执行过程默认折叠为一行摘要；展开看五步时间线；再下一层才是 工具调用 / Skills / Agents / 证据 / 原始日志（审计层）。
- Artifact 卡片内嵌实时缩略预览 + 验证徽章；主动作只有一个。
- AI 回复不进气泡，只有用户消息是轻量气泡。
- 标题上方加任务状态徽章（「已完成 · 1 个产出物」），面包屑体现 空间 / 对象。
- 「工具 / 社区 / 管理」移到头像旁设置入口，左栏第一层只剩对象。

自评问题（驱动 v3）：
1. 下一步仍是一排泛化 prompt 胶囊，跟产出物没有关联。
2. 搜索只是搜索框，不是 Universal Command。
3. Composer 不知道当前上下文，`/ @ #` 无可发现性。
4. 没有深色、没有窄屏/手机方案；Inspector 在 1280 以下挤压正文。
5. 「Augment Human Creativity」的人文层完全缺席。

## 迭代 3 — 从页面变成工作空间

- **Next Action 绑定产出物**：「用这个产出物继续」→ 变成演示文稿 / 拆成 Board 工作坊 / 做成教学模板 / 逐个解释，带预期耗时与去向；产出物底部加 在 Board 中打开 / 存为模板 / 发布。
- **⌘K Universal Command**：动作（新建、启动 Workflow、把当前产出物变成 PPT）+ 跳转（Board / 对话 / Agent），支持自然语言查询。
- **Composer = AI Command Bar**：当前产出物自动作为上下文胶囊；输入 `/`、`@`、`#` 弹出 Skill·Workflow / Agent / 项目。
- **Inspector 加「谱系」**：意图 → 引用 → 产出 v1，为版本、审计、Evidence 做铺垫。
- **响应式**：≤1240 Inspector 变右侧抽屉（顶栏按钮开关，Esc 关闭）；≤860 单栏、导航隐藏、Inspector 变底部抽屉，产出物操作折为图标。
- **深色模式**（跟随系统 + 手动切换）、`prefers-reduced-motion`、`:focus-visible`、Tab 的 ARIA 角色、⌘K 为 `role=dialog`。
- **环境层**：右上角极弱的渐变 + 山脊剪影，仅此一处。
- 最近工作用状态点（进行中 / 已完成）代替纯时间，左栏本身就能看出哪些工作还在跑。

## 落地建议（非本 PR 范围）

按根 `AGENTS.md`，改生产 UI 需先走契约束 `design-signoff.md` 签核。建议拆成独立 feature：
① 执行摘要折叠组件（改 `chat-task-inspector` / 执行过程渲染）；② Artifact 卡片 + 下一步；③ Inspector Tab 化；
④ 左栏对象化导航；⑤ ⌘K 命令面板；⑥ Composer 上下文胶囊与 `/ @ #`；⑦ 响应式与深色。

## 落地到 `/chat`：第一步只改样式

2026-09-28 人类指令：「不要改变业务逻辑，只是改变 UIUX；composer 功能与其他功能入口都保留」。
只改 Tailwind className，全部用既有 token（lint-design 通过）；不改数据流、状态、事件、`data-testid`、文案，不删任何入口。

| 部位 | 文件 | 变化 |
|---|---|---|
| 执行过程摘要 | `components/chat/workbench/run-trace-panel.tsx` | 裸文字行 → 安静卡片（`bg-card shadow-sm`），整行可点、箭头靠右；默认仍折叠 |
| 产出物卡片 | `components/chat/produced-file-inline-card.tsx` | 浮起卡片（`rounded-container shadow-md`），文件名加粗加大 |
| 线程标题栏 | `components/chat/copilotkit-v2-shell.tsx` | 标题 16px semibold，可见性标签去边框 |
| Composer | `components/chat/copilotkit-v2-panel-body.tsx` | 白底 + `shadow-lg` 浮起指令栏；全部按钮与功能原样 |
| 右侧 Inspector | `components/chat/chat-task-inspector.tsx` | 背景退为 `bg-panel-alt`，选中页签白底分段样式 |
| 跟进建议 / 工具组 | `components/chat/copilotkit-v2-assistant-message.tsx` | 卡片化、边框减弱 |

前后对比：`shots/app-before-run-trace-artifact.png` → `shots/app-after-run-trace-artifact.png`。

## v3 补丁：组织切换（2026-09-28）

v3 初版左上角放的是品牌 logo，与 2026-08-11 信息架构裁决（左上角 = 当前组织，点开切换组织，见
`apps/web/components/shell/org-menu.tsx`）冲突。已改为：

- 左上角 **组织切换器**：组织头像（圆角方块）+ 组织名 + 成员数 + ▾ → 菜单：切换组织（单选、当前打勾、
  其他组织显示「● N 个进行中」）/ 组织管理 / 创建或加入组织。
- 「空间」分组标题改为「<组织> 的空间」，切换组织后空间与最近工作一起切换；面包屑首段显示组织名。
- ⌘K 增加「切换到组织 · …」。
- 个人头像仍在左下角（正圆），组织与个人一眼可分。

截图：`shots/v3-orgmenu-1-1440.png`（菜单展开）、`shots/v3-org-hr-1440.png`（切到海尔法务后）。
参数：`v3.html?orgmenu=1`、`v3.html?org=hr`。

未覆盖：手机宽度（≤860）下左栏隐藏，组织切换入口暂缺，需在移动端导航抽屉里补。
