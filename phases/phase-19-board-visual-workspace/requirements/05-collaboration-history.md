# 多人协作、历史与恢复

## R1 用例
多人、会议室和 AI Agent 同时编辑 Board，并在离线、重连、撤权、崩溃后保持一致且可恢复。

## R2 前置与触发
参与者有对应 ACL；通过 WebSocket 加入 room、产生 operation、离线重连、Undo/Redo、checkpoint 或会议室配对触发。

## R3 主流程
1. Y.Doc 是共享事实源；presence 展示光标、选区、用户/Agent 身份，presence 不进入内容历史。
2. Fabric gesture 转领域 operation/Yjs transaction；远端 update 按字段增量投影，避免并发字段互相覆盖。
3. 用户 Undo/Redo 只处理其允许的本地语义动作；服务端确认后才播报成功。
4. 评论锚定 object id/world position，支持回复、解决和权限可见性。
5. 离线 operation 加密排队，重连后幂等提交并收敛；checkpoint/更新段可恢复到可验证版本。
6. 会议室展示者广播单调 revision 的 viewport，参与者跟随/退出跟随；刷新后恢复最新权威 viewport。

## R4 备选与异常
- A1：删除 Undo 通过认证 tombstone restore 协议保留原 id/引用，不能直接修改单调 tombstone。
- A2：用户可退出会议室跟随后本地浏览，不影响 presenter。
- E1：短暂限流/依赖不可用按可重试关闭码退避重连，保留 Y.Doc 和待发送操作；永久拒绝才清除未授权数据。
- E2：过期/重复 operation 幂等忽略；revision 回退、分叉或 hash 不匹配立即停止并报告。
- E3：撤权时关闭 transport、清除 outbox/cache/presence，不能在刷新或重连后恢复。
- E4：恢复点损坏时回退到最近验证快照+更新段并生成审计事件，不能返回空 Board 假成功。

## R5 权限
Owner/Editor 可编辑；Commenter 只评论；Viewer 只 presence/阅读；Agent 受主体 scope、预算和审计限制；会议室控制另有 presenter 权限。

## R6 后置与不包含
所有已确认 operation 最终在授权客户端收敛且无丢失/重复/分叉；presence 自动过期。本轮不包含匿名公共编辑。

## R7 业务规则
- AI 与人类 operation 共享 schema、校验、ACL、幂等和历史。
- Undo 不能覆盖他人后续字段修改；删除/恢复保持引用连续。
- 任何“已保存/已撤销”提示必须晚于权威确认。

## R8 界面线索
协作者头像/光标、连接/离线/重连状态、评论侧栏、Undo/Redo、checkpoint/版本历史、会议室跟随控件。

## R9 非功能约束
- 50 个浏览器同时入场、至少 20 writers、连续 30 分钟；同步 p95 ≤300ms，零丢失/重复/分叉。
- 会议室连续 30 分钟、至少 360 revisions；viewport p95 ≤3000ms，无空白和回退。

## R10 依赖
Yjs provider、Board gateway、PG ACL、对象存储更新段/checkpoint、离线加密、会议室会话。

## R11 切分
第 5 轮协作/history；第 9 轮会议室、50 客户端、灾备和长时 soak。

## R12 验收线索
两个真实浏览器覆盖并发字段、Undo/Redo、评论、离线重连、撤权；签名 soak ledger 证明客户端数、延迟、序列、hash 和恢复结果。
