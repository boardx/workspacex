# 访谈 Markdown 源 API：阶段性验证

关联 issue：#4400。沿用原 worktree，未创建新 worktree，未自动合并。

## 已验证范围

- `GET /interviews/digital/:interviewId/markdown` 返回文档原文及服务端状态元数据。读取前后按访谈可见性授权，正文经 Guarded 披露；验证 CRLF、中文、Emoji、GFM 表格原文完整保留。
- `POST /interviews/digital/:interviewId/markdown/:step` 追加草稿版本。聚合版本和文档版本冲突返回 409；同组织不可见、跨组织及不存在对象返回 404。请求不能设置证据身份、引用或审批状态。
- `POST /interviews/digital/:interviewId/markdown/:step/confirm` 仅确认当前草稿，追加原文相同的新版本，不修改原草稿；确认后草稿接口拒绝静默覆盖。这是文档确认，不是报告审批。
- 新 Markdown 生成用例只向固定模型传已确认文档原文，不 JSON 编码研究正文。输出原文追加存储，截断片段保存为 failed；刷新可读，重试追加版本，失败版本不被覆盖。
- `POST /interviews/digital/:interviewId/markdown/:step/generate` 已接入生产依赖装配；生成用例通过真实数据库与仓储测试。模型在测试中为替身，不属于真实模型验收。
- 确认后的文档不能通过草稿接口直接改写；必须接入现有 revision 分支确认流程，不允许无提示地令下游失效。

## RED → GREEN

- 原文读取：路由缺失 404 → 原文及三类不可见目标 HTTP 验收通过。
- 草稿写入：路由缺失 404 → 保存成功、旧版本 409、禁止正文提权参数 400。
- 模型用例：模块缺失 → 原始确认 Markdown 入模、原文输出入库、旧版本及权限拒绝验证通过。
- 截断保存：刷新后分析文档不存在 → failed 原文可恢复、失败版本保留、重试生成版本 2。

四文件 focused 测试：40/40 通过。随后全量访谈回归 70 文件 / 503 项通过（尚不含随后加入的确认与引用用例）；新增确认后 controller 15/15 通过，受控引用 formatter 4/4 通过。API typecheck、权限/架构 lint、契约 focused 9/9 通过。

日志位于本计划 `.superpowers/sdd/2026-09-27-interview-markdown-source/`：`task3-api-suite.log`、`task3-confirm-green.log`、`task3-references-green.log`、`task3-source-api-typecheck.log`、`task3-source-api-lint.log`、`task3-source-api-contracts.log`。最新全量复测排队近八分钟，系统负载约 90、swap 使用约 17 GB，资源门禁未允许启动；已取消自己这次尚未启动的复测（exit 130），未停止其他任务，不伪称最新全量已通过。

## 尚未完成的边界

旧专家、提纲、回答及报告消费者尚未全面从 JSON 正文切换到 Markdown 单源。文档确认与 workflow revision 的整合、全链路暂停/续跑、真人证据审批、各页面接入、真实模型与浏览器验收仍待完成。本记录不代表原型重构完毕或 PR 已可合并。
