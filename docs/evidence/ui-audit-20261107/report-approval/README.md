# #6362 报告工具审批中断恢复

真实中国站导出在工具授权阶段抛ToolAuthorityError，未进入既有审批中断流程。当前修复仅把合法approval_required转为LangGraph可恢复中断；其它未知、取消、租约或权限拒绝继续失败。恢复须再次向host核验当前持久call、参数摘要、attempt、租约。新增approvedOnce只标记已完成精确校验，防重放时绕过编辑后的参数。

未创建run或standing grant。既有锁定L0文档来源+安全命令继承规则继续由host判定；不满足时走已有对话审批入口。Skill pin/body_read/execute/publish/真实附件验收未降低。

独立安全review最初发现：marker缺失/过期且已有宽grant会跳过pending编辑校验。旧候选未提交；v2依据持久pending call触发，新增反例均通过。Python与TS分别由非作者会话审查，属于同账号审计投影，不冒充GitHub FormalApproval。

正式仓库验证：host24、native49、schema1通过；额外native边界34通过/3项既有跳过，跳过项不计通过。跨边界回归另见同PR测试。生产只读取证与受控测试分开：尚无修复后的生产真实PDF/Word文件验收，不把fake model/存储替身当作该项通过。
