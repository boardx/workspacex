# 第二提交：报告历史真实链路的验收代码

任务：由root要求继续补足新报告功能的实际原生验收。只扩展同一条native spec，不改A3业务实现，不启动浏览器/构建，也不将静态发现当功能通过。

已与A3核对 `bd2493736` 的真实collector和 `AidtStagesService.history`：每阶段最多两页，每页5项；服务查询limit+1，只有确有下一项才将本页最后revision作为nextBeforeRevision。当前合成验收旅程的S6 head7必须返回V7..V3和cursor3，然后beforeRevision3返回V2,V1和null。S2尚无提交，是应在报告保留的真实缺口。

新增 `appendNativeReportHistory` 断言：

1. 在已保存report的可见textarea加学生人工审阅marker，保留原正文；展开原生历史审阅入口。
2. 在点击读取前登记6个首分页和S6第二页的真实HTTP响应。逐项检查200并按canonical history schema解析；第二页URL必须使用第一页的实际nextBeforeRevision。拼合S6两页必须逐字等于6份学习回执+原报告head，不能只拿最新5项。S2真实响应应空且cursor为null。
3. 等待可见历史章节，核对各步标题、S6首轮V1与最新head及各自学生原因、暂未决定、缺口和保存修订非独立学习轮次的说明；不允许把失败/预算用尽/截断当本例成功。读取后textarea必须仍等于人工修改前缀；读取过程中不发阶段写请求。
4. 未勾审阅前追加按钮禁用；勾选后追加，textarea必须精确等于原人工稿+完整可见章节。追加仍不发阶段写请求，实际API head保持原回执。
5. 学生主动保存后，等待实际S6 PUT200，报告正文精确等于追加内容、draft不变、revision只递增1；实际GET及可见保存回执一致。随后精确回读旧报告revision，确认旧markdown/草稿/来源未被修改。
6. 将`v2.saved[6]`更新为新保存回执。真实双停启后，新的浏览器context重新登录，报告textarea必须精确恢复追加正文，并保留完整历史章节、人工marker、首轮旧原因及S2缺口。原6步、旧返回上下文、成员文字与退出/端口门槛均保留。

这是对真实后端/浏览器的**待运行断言**。未使用route interception、mock响应或生成模型。A3组件和root的historyScope接线缺失时，原生用例应失败。root完成整合冻结后仍使用本目录README中的标准native命令完整执行。

第一提交peer-review中对报告“limit5只读首5”的初步担忧现已核对并纠正：collector实际会读第二页，最多10份/阶段，本例7份S6应全部可读。此前未计为任何原生通过。

A3只读复核确认选择器、分页及拼接格式与实现一致。另加入关键反例：新报告`summaryReport.sourceStageRevisions`必须精确保留原报告来源，不能在历史追加或人工编辑后擅自把正文来源改绑到当前S6 head；root须整合A3来源修复`dee225c76`后统一验证。

## 同次集成A4真实成员文字helper

按root追加要求，在首cycle原报告和`humanText`保存、全局插件关闭后，调用A4独占的`acceptAidtMemberText`，使用当前登录页的原生Bearer fetch adapter（现有`api`扩展GET/POST/JSON body）。不复制或修改helper业务：真实UI发送主频道消息及单层话题回复，验证频道/话题两份未发草稿关闭插件、S6→S1的应用内导航和重开后的独立恢复；实际API重放同clientMessageId并回读各一条。helper清除自己创建的未发草稿，最终关闭插件，不改阶段成果。两份关键视图写入private native output目录，generationRequests仍须为空，之后保留原stop/restart及精确回读。

最终代码独立提交：`2b29d5030f1aa303f40a0e352f002b267b3e3a6b`，只含native spec。最终ESLint退出0；TypeScript对该spec的语法/语义诊断0（非全Web检查）；`--list`准确发现1例；`git diff --check`退出0。日志和明确的未运行边界见`report-history-validation.json`及同名前缀输出。

A4原helper提交为`d912a7f0285ccc47255119ada182b3170084b5e5`。按root授权为解析import临时借入，在本分支因缺其早先A4文档而保留owner原文解决modify/delete，形成`9c6ab9d71`；root单独pick原helper提交，**不要pick这个借入提交**。没有复制或修改helper。新增恢复检查还会在双停启后的新登录真实GET中精确匹配helper的root和单层reply回执。
