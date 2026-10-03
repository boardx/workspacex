# 实时转录按钮验收 — 2026-10-04

结论：**未全量通过**。真实个人转录管理入口已点击；ASR、最终删除与项目段落编辑仍有明确边界，不能用单测或已合并 PR 代替。

## 环境与版本

- 管理入口：独立 IAB 标签访问 localhost:3000；该服务现有工作区 `/Users/shenyangjun/.codex/worktrees/research-latency-title/workspacex`，检查时干净，HEAD `09f220ec772b0e424ef08b30e6d7a9aca22cfa76`。未重启或修改该服务。
- 拉取最新 main：`814dc05a36e1f2645b7528b9dacc0a344ec615ae`。本轮涉及的 rec 组件与个人转录客户端同旧服务版本无差异；并不据此宣称全部 API/部署同版。
- 修复实际 main 基线：`caf445c3c65eab8e614ea9ecd60cfaa112879f46`（开分支时共享 origin/main 已包含 #5254/#5256；与最初 fetch 的 814dc05a 不同）。PR 比较当前 main，仅包含本模块改动。
- 修复工作区：`/Users/shenyangjun/boardx/workspacex/.worktrees/coord-voice-f175-transcription-management`，复用旧干净 worktree；分支 `codex/voice-review-navigation`。本 session 未创建新 worktree。
- 导航修复真实 UI：本会话独立 localhost:3318，基于最新 main；测试代码 exact SHA `502d225dc0fb1aee1257a59807a48aa0d7ae5093`。从实时页及引述页实际点击进入校对页，保留角色/载体/项目参数。
- 测试资料：新建 `语音按钮验收-20261004-合成文本`，改名 `语音按钮验收-20261004-已改名`；标签 `voice-audit`、`合成验收`，正文仅含合成测试句子。未采人类音频、未删除对象、未分享资料、未部署。

## 矩阵（按独立行为族统计，不将重复卡片按钮重复充数）

PASS 表示本轮真实点击及可观察结果；BLOCKED 包括明确条件缺失或尚未完成的动态证据。项目示意交互不计为生产能力 PASS。

| ID | 入口/行为 | 状态 | 本轮证据或边界 |
|---|---|---|---|
| P01 | 历史空态/对象计数 | PASS | 开始 0，创建后 1，取消未增数 |
| P02 | 顶部新建 | PASS | 实际打开名称标签弹窗 |
| P03 | 卡片新建 | PASS | 实际打开同一弹窗 |
| P04 | 空名称校验 | PASS | 清空名称后提交按钮 disabled |
| P05 | 创建/名称/标签提交 | PASS | 进入真实工作台，刷新后卡片仍在 |
| P06 | 标签建议/添加/移除 | PASS | 选择已有 voice-audit，显示移除入口，移除后取消 |
| P07 | 新建取消 | PASS | 回到列表，仍 1 条 |
| P08 | 新建关闭 | PASS | 点击 X 回到列表，仍 1 条 |
| P09 | 搜索命中/无匹配 | PASS | synthetic 名称命中 1；不存在名称显示过滤空态 |
| P10 | 标签筛选 | PASS | voice-audit 勾选，保留命中卡片 |
| P11 | 排序切换反馈 | PASS | 最近更新切换为最早更新 |
| P12 | 多对象实际排序 | BLOCKED | 本轮只有一条新建合成对象，未验证多对象顺序 |
| P13 | 更多菜单 | PASS | 显示修改/删除；未伪造 recording 状态 |
| P14 | 修改名称/标签/保存 | PASS | 新名称、新标签投影到卡片，重新打开正确 |
| P15 | 进入/返回历史转录 | PASS | 本轮实际往返列表与工作台 |
| P16 | 正文编辑/保存 | PASS | 写入合成正文，保存后显示且能读回 |
| P17 | 正文取消修改 | PASS | 修改草稿后取消，原正文保留 |
| P18 | 刷新恢复 | PASS | 刷新回到列表，重新进入后正文与改名仍在；不是工作台 URL 自动恢复声明 |
| P19 | 复制按钮反馈 | PASS | 点击显示已复制，见 copy-fulltext.png |
| P20 | 剪贴板字节一致 | BLOCKED | IAB clipboard.readText 返回空；未把已复制反馈当作内容通过，尚不能归因为应用故障 |
| P21 | 麦克风菜单 | PASS | 默认设备菜单打开，提示授权后显示其它设备名；未授权物理麦克风 |
| P22 | 输入电平真实变化 | BLOCKED | 未采真人音频，只有空闲 0 电平观察 |
| P23 | 开始/继续真实采音 | BLOCKED | 无物理麦克风授权，合成输入注入命令被 IAB 判 unsupported |
| P24 | 连接中取消 | BLOCKED | 未实际启动可控采音连接 |
| P25 | 停止/重复停止/尾帧 | BLOCKED | 未执行真实采音，54 条回归不充当浏览器 PASS |
| P26 | 实时 interim/final 增量 | BLOCKED | 未连接真实供应商，也未宣称 loopback 是真实 ASR |
| P27 | 自动重连/手动重连/异常关闭 | BLOCKED | 无可控真实流；相关单测通过只作回归 |
| P28 | 停止最终正文保存/刷新 | BLOCKED | 人工正文保存已验证，ASR 最终正文未验证 |
| P29 | 删除弹窗/取消 | PASS | 对象名正确，永久删除警示明确，取消保留对象 |
| P30 | 最终永久删除 | BLOCKED | 已提出特定对象确认，未获答案则不执行 |
| P31 | 遗留 recording 状态的结束菜单 | BLOCKED | 无本轮可控 recording 遗留测试对象 |
| P32 | 项目实时页去校对 | PASS | 基线 FAIL；#5258 修复后 3318 实际点击正确进入校对 |
| P33 | 引述页去校对/保留只读角色 | PASS | 修复后保留 groupLead，写操作仍禁用 |
| P34 | 项目人工修正文本 | FAIL | 实际点击无编辑器，无 handler；独立 #5260，未混装修复 |
| P35 | 个人暂停独立按钮 | 不适用 | 签核设计为停止后可继续，新 capture，不存在独立暂停入口 |
| P36 | 个人说话人/时间戳编辑 | 不适用 | 当前签核是连续正文；自动说话人后续需求 #3720 未完成 |
| P37 | /rec 音频上传/导入/分享 | 不适用 | 当前实际 rec 组件无此入口；不据此宣称其它模块上传能力不存在 |
| P38 | 个人音频播放/定位 | 不适用 | 当前个人工作台无播放器；项目示意时间码不是实际播放 |

统计：**22 PASS / 11 BLOCKED / 1 FAIL / 4 不适用**，适用行为通过率 22/34=64.7%。这是上表行为族覆盖率，不是全部 DOM 按钮、生产部署或真实 ASR 通过率。

## 项目示意屏边界

`mode=project` 进入 prep/process/verify/live/assign/annotate/retention 七个静态原型屏。当前真实产品 `/rec?projectId=…` 仍是个人转录+项目关联。项目屏麦克风切换、时间码、指派和 AI 确認只是本地状态；标引述/标记时刻/查看原文、代表片段播放、拆分、人工修正、改绑 RQ、编辑后确认与删除证明等没有真实接线。

本轮真实点击了 live 的关麦、时间码、标引述、标记时刻，及 assign 的人工修正；关麦仅改变 mock 文案，标记与编辑没有有效后置行为。其它项目示意屏已完成代码入口清点，但尚未逐个真实点击；不宣称七屏全按钮验收完成。recording 契约已有 API 和 confirmed 签核，需真实 session/segment 加载后再做持久化接线，不用本地 React 文本冒充。

已有开放跟踪：#945 设计束、#1069 实时客户端、#3720 自动说话人、#1150 停止收尾；#1150 虽开放，关联 PR #3306/#4951 已合并，不能据开放 issue 判实现缺失。权威 feature_list 的 F167 仍 not_started，而代码已存在，记录该状态/代码差异，未自行改状态。

## #5258 修复与验证

根因：相对链接 `?screen=assign` 覆盖整个查询串。复用 `useRecScreenHref`，复制当前查询参数并仅 set(screen)，两个出口共用。

- 初始化：先失败于错误 pnpm11 与旧 worktree 根依赖指向共享 checkout；只解绑本 worktree 自己软链接、使用仓库 pnpm9.15.0 独立安装后 `./init.sh` 快速路径退出 0。见 init.txt。
- 反证：4 个导航行为测试失败于 mode 丢失。见 navigation-red.txt。
- 回归：`corepack pnpm --filter web exec vitest run tests/ui/rec-review-navigation.test.tsx tests/ui/rec-fidelity-gaps.test.tsx tests/ui/realtime-transcription-workspace.test.tsx tests/ui/realtime-transcription-history.test.tsx`：54/54，退出 0。
- `corepack pnpm --filter web typecheck`：退出 0；先重建独立工作区 fabric-markdown 产物解决旧声明文件。
- 改动文件 `next lint --file …`：无 warning/error，退出 0。
- 独立 reviewer `/root/review_voice_navigation`：只读 diff，未发现阻断项；其测试被默认 pnpm 环境阻塞，54 条执行证据来自实现会话。
- 真实 UI：project-live-before-review.png / project-review-wrong-history.png 为基线反证；project-review-fixed.png / annotation-review-fixed.png 为修复后真实点击。仅证明导航与角色视角，不证明原型业务持久化。

## 待完成与资源

主会话回传尝试被自动审批拒绝，理由为缺少可信人类跨会话授权；已在本会话提出直接确认，未绕过。协调网关上轮403未认证，未认领或续租、未新增循环。

官方 macOS `say` 生成 6.58125 秒、16kHz 单声道合成语音，文件 `/private/tmp/voice-synthetic-20261004.wav`；IAB 不支持 Page.addScriptToEvaluateOnNewDocument，未注入、未获取麦克风权限、未发真人音频。后续具备虚拟麦克风的隔离栈可继续验收。

本轮未起 Docker 栈。3318 为本会话 Web 服务，收尾需停止；他人3000服务保持。新增左上角返回列表任务独立排入，不与 #5258 混装。
