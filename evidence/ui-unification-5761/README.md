# 用户访谈紧凑 UI 验收 #5761

父单 #5756。源码 `9d90805ef9976591c8e69b3bc7c54be78bd348d1`；共享 Button/Bar 来自 #5760，不复制规则。4 个访谈展示文件以外只有回归测试与证据。

- 51 UI 测试、web 类型检查、目标 eslint、2 个真实隔离全栈浏览器测试通过。命令与结果见 [manifest.json](manifest.json)、[verification.txt](verification.txt)。
- 实际 375 / 768 / 1280 验证列表、创建、专家长表单、已保存完整资料和报告嵌套操作组。字段/私有范围/模拟证据、关闭回焦与保存重载保留。
- `workflow-metrics.json` 是实际页面计算样式与数据库活动计数；前后模型运行和请求均为 0。没有点击生成或分享，没有实际文件生成声明。
- 仅合成账号和资料。所有截图按原始字节保存，已逐张查看；本任务没有生产用户资料。

## 代表实页

| 页面 | 375 | 768 | 1280 |
| --- | --- | --- | --- |
| 列表 | [截图](history-compact-375.png) | [截图](history-compact-768.png) | [截图](history-compact-1280.png) |
| 创建弹窗 | [截图](create-compact-375.png) | [截图](create-compact-768.png) | [截图](create-compact-1280.png) |
| 专家表单 | [截图](add-expert-375.png) | [截图](add-expert-768.png) | [截图](add-expert-1280.png) |
| 专家完整详情（滚动底部） | [截图](builtin-full-375.png) | [截图](builtin-full-768.png) | [截图](builtin-full-1280.png) |
| 报告嵌套导出组 | [截图](report-nested-actions-375.png) | [截图](report-nested-actions-768.png) | [截图](report-nested-actions-1280.png) |

[填写完整字段](custom-full-form.png) · [保存刷新后详情](custom-full-reloaded.png) · [空表单验证错误](expert-form-validation-error-375.png)。错误截图记录插入错误提示的即时位置，保存按钮部分在当前滚动帧下方；用例随后滚动并完成真实保存与重载。保存 pending/网络失败保输入通过 deferred UI 测试，不冒充生产故障。
