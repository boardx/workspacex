# Claude design skill：真实模型设计与视觉走查

测试项目：[巷口烘焙社·生产排班](http://127.0.0.1:3192/studio/design-workbench/5a6c2934-3964-48cf-bb3d-72be90e74012)。原[情绪日记](http://127.0.0.1:3192/studio/design-workbench/006d9395-5649-4471-91ab-fc9554534a0f)保留。

真实 Chromium → UI 发送 → API → 已配置 DashScope → PGlite → 浏览器刷新。需求及数据均为虚构例子。没有 route mock、固定模型回复或人工注入成品 HTML。

## 实际视觉判断

已使用 `view_image` 阅读桌面排班、批次明细、键盘焦点和两页实际 375px 截图。

- **主体与布局通过**：桌面以机台 × 时间轴作为主体，区别于情绪日记的单列心情表达；没有营销 hero、同款圆角卡片阵列或装饰插图。格线解释时间关系，分轨解释重叠任务。
- **用户方向通过**：保留指定牛皮纸浅底、深咖啡文字。铜锈用于焦点框、冲突边框等结构提示；用户偏好优先于默认视觉套路。
- **字体与层级通过**：工单标题使用宋体方向，正文使用清晰系统字体，批次编号和时间使用等宽字体以对齐生产数据。最终批次四行完整显示，避免初版文字压缩与裁切。
- **文案通过**：使用“生产排班”“批次明细”“返回排班表”、明确豆名、重量、负责人和时段，不使用泛化宣传语。日期属于固定虚构数据，不能读成当前实际排产。
- **任务语义通过**：真实 DOM 几何与独立时间换算一致；同一 1 号机 R01/R02 在 08:30–09:30 重叠。独立 2 号机 R03 不标设备冲突，批次详情同口径。

## 动态证据

| 项目 | 实际结果 | 证据 |
|---|---|---|
| 真实模型生成与修订 | UI 请求/模型写回/刷新后保留 | `real-model-result.json`、`business-model-result.json`、`batch-element-model-result.json`、`final-project.json` |
| R01 08:00–09:30 | left=0、width=.1875；父时间行1112px，条宽208.5px | `business-geometry.json` |
| R02 08:30–11:00 | left=.0625、width=.3125；条宽347.5px | 同上 |
| R03 09:30–11:00 | left=.1875、width=.1875；条宽208.5px | 同上 |
| 每批次鼠标进入明细 | 3/3 | `mouse-navigation.json` |
| 键盘焦点与 Enter 跳转 | BUTTON、`:focus-visible`、solid 2px铜锈 outline；Enter进入明细 | `accessibility.json`、`05-keyboard-focus.png` |
| 减少动效 | 包含减少动效规则，模拟 reduce 后 matchMedia=true | `accessibility.json` |
| 文本对比 | 排班36个可见文本样本最低6.5866；明细18个最低9.5122；无低于4.5样本 | `text-contrast.json` |
| 排班实际375px响应式 | iframe clientWidth=375、scrollWidth=375、内部横向滚动容器为空；按机台纵向重排 | `metrics.json`、`04-schedule-mobile.png` |
| 明细实际375px响应式 | clientWidth=375、scrollWidth=375；两列改一列 | `batch-mobile-metrics.json`、`06-batch-mobile.png` |
| 输入标签 | 本案例无 input/textarea/select，标不适用 | `accessibility.json` |

移动端测试把持久化模型 HTML 放入实际 375px 的 sandbox iframe，未修改保存数据。它没有把桌面画布缩放冒充响应式。

## 首轮失败与修订

保留 `initial/`、`first-revision/`、`second-revision/`、`contrast-revision/`，不把首轮机械评分当视觉通过。

1. 首轮真实失败：机台时间行只占一格，批次仅18px宽、编号宽0，实际375需内部横向滚动；初次截图还在 iframe 绘制之前，空白截图另存 `failure-blank-schedule.png`。
2. 首修只修宽度：按钮40px高，豆名span高度5.41px但scrollHeight17，文字仍裁掉，斜纹穿过正文。按真实尺寸诊断再次修订。
3. 后续修订补完整四行、独立冲突提示、真正375纵向重排。再发现条宽与印刷时段不一致、跨机假冲突、小字对比不足，分别将这些具体问题交给真实模型修正。
4. 第二页模型最初漏改编号颜色，经真实“页面结构”选中整页后仅修该CSS颜色；最后响应保留且 source=model。

## 边界与可复现性

截图由本次验收浏览器生成并由 agent 目视审查；模型收到的是具体几何/视觉问题文字。当前产品没有自动截图并视觉评价的运行时闭环，不能保证下一次任意 brief 首轮就通过。

批次编号直接在画布点击时，被相邻标题拦截；没有 force 点击或篡改 DOM，通过已有“更多 → 页面结构 → HTML根”完成真实 UI 修订。此项直接元素点击边界保留，不能由三批次导航通过推成所有文本都可直接选中。

第二页一次模型请求的原始HTTP响应因测试脚本文件名错误未保存，修改已落库；`final-project.json` 最后一组对应对话保留 `source: model` 与回执，后续编号修补的原始响应完整保存。脚本错误已修。

重跑纯本地检查：

```bash
node scripts/local-session/design-html-skill-session.mjs --project 5a6c2934-3964-48cf-bb3d-72be90e74012
```

`--revise` 才调用真实模型；需要既有授权。脚本通过 try/finally 关闭浏览器。测试服务按用户要求保留，登录信息在 `/private/tmp/wsx-html-user-login.txt`（0600，不入 Git）。
