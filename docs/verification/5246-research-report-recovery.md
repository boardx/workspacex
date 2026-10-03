# #5246 报告暂停与恢复

报告继续生成原来重新筛选完全相同的来源，可能在正文前失败；报告暂停命令又被共享契约拒绝。恢复复用相同 basis 的来源准备，并允许 report pause/resume 保持版本和幂等保护。前端同版本旧流消息不能覆盖新的控制状态。支持继续生成与显式从头重新生成。

按用户补充要求，页面移除内部重试次数和证据批次数，显示整理百分比；质量限制仍保留为“部分内容待核实”。

## 验证
- API research unit：277 tests passed。
- report stream/reference/timeline UI：51 tests passed；新增文案反证后 timeline 13 tests passed。
- contracts research trust：7 tests passed（report pause/resume 通过；缺 revision/幂等键及 report source policy 失败）。
- API/Web/contracts typecheck passed；受影响 Web ESLint passed。
- 独立 reviewer 审查恢复与契约无新增问题；无关 pnpm-lock 改动已恢复。

## 真实本地边界
会话 grs_13fe9f9ed61748d0b7084446fbaa4b6e。本地 KERNEL_MODEL_REASONING_EFFORT=none、KERNEL_MODEL_STREAM_ENABLED=1，API 已重启生效；这是忽略的本机配置，不改变其他部署默认配置。关闭深度思考后有正文输出，保存 4/5 章节，但第五章返回格式不合要求，仍有质量警告；不能宣称完整报告成功。随后真实暂停成功：busy=false, controlStatus=paused, reportPrevious 保留4章。正文格式/证据质量问题仍待进一步修复。
