# AI 协作与 Chat 图形交接

## R1 用例
用户把 Chat 中看到的 Mermaid/Fabric 图形原样插入 Board，并让 AI 在可审核范围内生成、聚类、排版和修改对象。

## R2 前置与触发
用户对 Chat artifact 和目标 Board 有权限；点击“插入 Board”或在 Board 发起 AI 操作触发。

## R3 主流程
1. Chat 在点击时从实际 Fabric 场景提取版本化 `RenderedDiagramLayout`：稳定节点/边 id、world geometry、style、source revision、layout hash。
2. Board 服务校验权限、schema、hash 和幂等 key，把布局转换为普通领域 operations 并在目标 viewport 附近插入。
3. flowchart、sequence、persona 的用户可见位置、大小、文字、连线和分组保持一致；Board Fabric 直接投影新对象。
4. AI 读取授权范围内的 Board context，返回 proposal/diff；用户预览确认后，AI 以同一 operation 契约写入 Yjs。
5. AI 生成 Sticky、聚类、Smart Layout 和关系建议均保留 provenance、actor、模型/skill 及输入对象版本。

## R4 备选与异常
- A1：相同 idempotency key 重试返回同一结果，不重复插入。
- A2：用户可只插入选中的图形子集，hash 按选区计算。
- E1：source revision 与点击时内容不一致时要求刷新预览，禁止后台重新解析 Mermaid 后悄悄改变布局。
- E2：未知图元按明确降级规则转为可见占位并报告，不能静默丢失。
- E3：AI proposal 基于过期 object revision 时标记冲突并重新生成/人工选择，不覆盖新修改。
- E4：AI 无权限、超预算或超时只返回可诊断错误，不产生部分 mutation。

## R5 权限
同时校验来源 artifact、目标 Board 和涉及对象；AI 主体不能继承调用者未持有权限；跨组织插入禁止。

## R6 后置与不包含
插入后的对象与人工创建对象完全同构，可编辑、协作、撤销和导出；不保留运行中的 Fabric 实例。本轮不保证任意第三方图表语法。

## R7 业务规则
- 禁止“重新解析 Mermaid + 自动布局”替代点击时实际画面。
- 人、AI、Chat handoff、导入器均走相同 operation/ACL/审计路径。
- AI proposal 未确认前不修改正式 Y.Doc；自动化策略必须显式配置和可撤销。

## R8 界面线索
Chat 图形提供目标 Board/位置选择；Board 展示插入进度和降级报告；AI proposal 有 before/after 预览、确认、拒绝与 provenance。

## R9 非功能约束
布局 payload 有大小/对象数限制和严格 schema；文本/URL 清理；日志不记录私密 Board 内容或凭据。

## R10 依赖
`@repo/fabric-markdown`、Chat artifact、DiagramModel、Board operation API、AI proposal runtime。

## R11 切分
第 6 轮：布局提取契约、服务端 handoff、三种图形 E2E、AI proposal、聚类/排版。

## R12 验收线索
flowchart、sequence、persona 各用两个真实浏览器验证点击时 layout hash 与 Board geometry 一致；AI 与人工对同对象并发时无覆盖且可审计/撤销。
