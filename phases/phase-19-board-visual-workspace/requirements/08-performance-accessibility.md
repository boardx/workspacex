# 性能、可访问性与九分验收

## R1 用例
用户在大 Board、移动/触控设备和辅助技术下仍能高效操作；团队以固定证据判断是否达到九分。

## R2 前置与触发
加载 1k/5k/10k 混合对象基准板，或使用键盘、屏幕阅读器、触摸、笔、缩放/重排；第 8–10 轮门禁触发。

## R3 主流程
1. Fabric adapter 使用 viewport culling、空间索引、对象缓存和合并 `requestRenderAll`，Yjs patch 只更新受影响对象。
2. 性能 harness 记录 cold/warm load、pan/zoom FPS、拖动/输入 p95、内存、长任务、同步延迟和恢复耗时。
3. React 无障碍层提供 Board/Panel/object 大纲、角色/名称/状态、选择、编辑、移动、连接、评论和 viewport 定位命令。
4. 键盘支持工具切换、Tab 顺序、方向键微移、快捷键、focus restore；200%/400% reflow 无遮挡；RTL、高对比和 reduced motion 可用。
5. 触摸/笔支持 pan、pinch zoom、选择、拖动、绘制，命中目标达到可用尺寸。
6. 第 10 轮固定 rubric 重跑 PRD 六条旅程、核心 E2E、迁移、协作 soak、会议室、API/存储/安全与灾备。

## R4 备选与异常
- A1：低端设备进入明确的性能模式，减少装饰/远距对象细节但不丢内容、身份或编辑语义。
- A2：Canvas 不可见时对象大纲仍可完成核心阅读与编辑流程。
- E1：内存/对象上限临近时阻止危险操作并给出分区/导出建议，不崩溃或静默丢对象。
- E2：性能采样或 soak 中断标记无效，不得用短窗口外推通过。
- E3：屏幕阅读器焦点对象被远端删除时移动到合理邻近对象并播报。
- E4：任一九分硬门缺证据或回归即保持未达标，并给出失败项，不四舍五入评分。

## R5 权限
无障碍替代层严格复用当前 ACL；性能/诊断 artifact 脱敏且仅对授权维护者可见。

## R6 后置与不包含
保存带环境、commit、dataset hash、样本和阈值的可复核报告；不以实验室单次最佳值代表通过。本轮不保证旧浏览器或专业绘图板全部厂商特性。

## R7 业务规则
- 10k 对象门必须使用真实 Fabric/Yjs/Board shell，不得用空矩形或 mock renderer 替代混合业务对象。
- Canvas 视觉层与可访问 DOM 大纲双向保持同一 object id/selection/revision。
- 九分不是主观宣称：全部 P0、固定阈值、真实迁移板、长时 soak、独立 exact-SHA review 和 CI 均通过才成立。

## R8 界面线索
对象大纲/搜索、跳到对象、键盘帮助、zoom/focus、性能模式提示均可发现；工具栏在 320px–大屏及 400% zoom 不遮挡核心操作。

## R9 非功能约束
- 基准阈值在契约签核时冻结；至少覆盖 desktop 主流浏览器和一个触摸 viewport。
- 50-client ≥30 分钟、meeting room ≥30 分钟；报告签名/hash/sequence 可校验。
- WCAG 2.2 AA 对核心流程；无严重 axe 违规，并有真实键盘/屏幕阅读器人工或自动化证据。

## R10 依赖
Fabric performance adapter、Playwright、多浏览器 runner、axe、signed soak ledger、恢复 harness、固定 datasets。

## R11 切分
第 8 轮性能和无障碍；第 9 轮长时/恢复；第 10 轮完整 rubric 与缺陷清零。

## R12 验收线索
1k/5k/10k 报告、三浏览器核心 E2E、键盘/屏幕阅读器/触摸证据、50-client 与会议室签名 ledger、灾备 restore hash、六条 PRD journey 视频/截图和逐项 rubric 全部可定位到 exact SHA。
