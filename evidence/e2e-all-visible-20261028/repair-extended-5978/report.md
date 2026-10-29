# #5978 失败修复与浏览器复测

原全面回归534项：509通过、17失败、8条原有跳过。本轮针对这17条逐项修复与复测。

**结果：原17条失败全部复测通过；去重后的定向浏览器回归33通过、2条原有跳过、0剩余失败。矩阵24/24。**

运行方式：有窗口Chromium、真实Web/API/Postgres/对象存储；模型上游为确定性loopback。基线main `3ba9f359023ea52c60df2d64a5e23c1315144489`，复用原worktree；28个修改源文件的校验值见[source-sha256.json](source-sha256.json)。

## 修复与验收

- 产品：迟到journal分类不再清空已显示的流式正文；审批归还焦点排除即将卸载的dialog子节点；开关点击区至少24px；计划确认阶段隐藏执行进度。
- 测试上游：补齐远端取消确认（包含生产query参数）及流关闭；有界live窗口在EOF前发送同源write_todos，支持真实运行期间编辑/进度验证。
- 用例：按人类#4764撤掉Inspector进度页签；真实展开事件/同名工具分组；等待hydration、附件持久化、Radix异步焦点和本轮权威运行完成。
- 版本consumer使用真实存储字节和生产registerRunArtifacts登记两版，实际读取、切换、预览和下载；无citation草稿如实显示未挂出处。

## 原17条失败对应结果

| 用例 | 最新批次 | 结果 |
|---|---|---|
| F153/#1560 P1：真实浏览器上传图片附件走 VLM，本机无视觉 key → 诚实降级为 failed，不假装已读取图片内容 | pass1 | passed |
| TW-P0-2②：每张能力卡披露六项（擅长/工具技能/可读材料/写权限/记忆范围/当前状态） | pass1 | passed |
| DA-19g 流式反馈 UI 帧级复核——assistant 正文的 DOM 文本长度随时间逐步增长，不是一次性跳变 | pass1 | passed |
| @path:F5 父 run 取消之后，它派出去的子任务停下来，且不再发布晚到的产物 | pass3 | passed |
| deep-agent 计划→执行：成功率矩阵 | pass4 | passed |
| TW-A11Y-2/3：小图标与圆形按钮点击区 ≥24×24，且仅图标按钮有可访问名 | pass1 | passed |
| TW-A11Y-5：审批弹窗焦点锁定 + Esc 关闭 + 焦点返回原处 | pass2 | passed |
| TW-P0-6③：风险分级生效——纯读操作不得弹审批（反证面） | pass1 | passed |
| TW-P0-4①：右栏提供材料 / 产物 / 运行详情，计划只在消息流显示 | pass2 | passed |
| TW-P0-4②：材料与产物自动切换，运行开始保留用户所选页签 | pass3 | passed |
| TW-P1-2：材料预加载——选线程之前就能加材料 | pass2 | passed |
| TW-P1-3：结构化工具事件与子 Agent 摘要在刷新后仍在（持久化侧） | pass2 | passed |
| TW-P1-4：产物四件齐（预览 / 来源 / 版本 / 导出） | pass3 | passed |
| TW-P0-7①：事件行措辞面向用户，不印裸工具名 / 裸 JSON / 裸枚举 | pass1 | passed |
| TW-P0-3②③：计划面板文案面向用户，且可调顺序 / 删步骤 / 加约束 | pass2 | passed |
| TW-P0-3④：复杂任务先确认计划，简单问题不加门槛（条件性确认门） | pass3 | passed |
| TW-P0-3⑤：执行态显示当前步骤 / 完成比例 / 耗时，且可暂停 | pass2 | passed |

机械核对：[原17条映射](original-17-retest.json)、[去重用例](latest-cases.json)、[统计](summary.json)。

## 验证证据

- Web定向单测：65 passed、4条原有skipped；provider：13套45 passed。日志保留红→绿反证。
- 受影响范围typecheck/lint：9/9通过（最终分组修正后）；`./init.sh`快速初始化通过。
- 独立只读review：发现Inspector提交空窗P2，修复后复审关闭；后续增量无未解决发现。
- [矩阵24次明细](plan-execute-reliability.md)。F5原用例未放宽：观察超过自然完成时间后仍cancelled、result为空、无产物引用与新增父线程产物。
- [版本与预览截图](browser-success/artifact-versions.png)、[Inspector截图](browser-success/inspector.png)、[确认截图](browser-success/plan-confirmation.png)、[取消截图](browser-success/subtask-cancel.png)、[矩阵截图](browser-success/matrix.png)。

分批结果如实保留：pass1=19通过/2失败/1跳过；pass2=11通过/5失败/1跳过；pass3=4通过/1失败（矩阵21/24）；pass4=1通过（矩阵24/24）。后续批次覆盖前批失败；不按累计执行次数冒充去重通过数。

中间发现并修复了本轮等待helper误用fullstack API前缀导致404；随后矩阵唯一剩余错误为同名工具分组计数。真实点击展开并逐条检查成员，保留原>=5阈值。类型检查曾与Next冷启动重建生成类型竞争，待服务稳定后9/9通过；未修改类型门控。

原始JSON与日志在本目录；trace.zip保留于本机各passN-browser目录（完整trace未入库）。本机原始有窗口配置在local-configs；复现可使用标准隔离命令：

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.chat-read.config.ts --project=chat-path-coverage --headed --workers=1 deepagent-plan-execute-reliability.spec.ts
```

## 边界与交付

- 全量基线的8条fixme保持原状，本轮选中其中2条，均未计通过。真实模型lane缺少本地DASHSCOPE配置；本矩阵量测确定性上游下的产品链路。
- 版本consumer验证不覆盖native模型产物生产；来源message不等于证据citation。
- 未修改feature passing状态，未部署或合入main。PR与实时CI结论见[issue #5978](https://github.com/boardx/workspacex/issues/5978)后续记录；本地通过不代替CI门控。
- 本轮测试栈释放情况见cleanup.json；控制平面tick缺少COORD_GATEWAY_URL，已在issue记录直接交办的队列外理由。

入库日志仅归一化行尾空白；原始输出本机保留于raw-logs，前后校验值见log-normalization.json。
