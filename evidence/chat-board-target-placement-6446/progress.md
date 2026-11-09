# #6446 聊天画布插入所选 Board

用户要求：最大化移到插入 Board 右侧；项目聊天列项目 Board，组织聊天列组织 Board；复用 Board 缩略预览，显示新内容与可拖动红框；显式确认后插入并可打开/刷新看到。

实现：提取 BoardMinimapScene 共用投影和几何，不改既有导航；项目复用 project resources，组织遍历 ACL Board 库全部页。placement-preview 使用可选 appearance=1 返回规范 kind/style/hidden，默认保持 geometry-only，无文本/资产。所有写入仍走既有有版本与幂等身份的 artifact handoff。界面过滤隐藏对象并隔离迟到的作用域响应。

新生成但尚未落地的源码只在确认后 landAsArtifact，再读服务器 immutableRevision 后构建真实 handoff；预览临时身份绝不提交。源码通过复用原canvasToMarkdown提取的modelToMarkdown单源序列化，同实际模型几何绑定并正确选择persona/canvas/mermaid语言；源码读回失败保留已落地产物身份；Board模糊网络失败复用同一请求身份。取消不写入 Board 或源码产物。

验证：初始缺失行为 UI red 4失败/7通过；复核修正 red 4失败/15通过（其中3为新preparer导出缺失）；最终 UI 10文件62项通过；API 2文件28项通过；core 11项通过；序列化4文件67项通过；最新turbo typecheck/lint 35项通过。独立只读review两项P2均已修复并复核通过。首轮浏览器在旧seed file-versions 404处失败，尚未进入产品链路；改为真实loopback执行器持久化assistant后，测试项目线程误用member-private且无group被数据库约束拒绝，已改合法private。之后真实loopback执行被测试账号insufficient_credit拒绝，未绕过计费。最终用例在本spec独立创建的真实线程中预置唯一持久化agent消息（隔离库、线程归属检查、精确清理），模型生成不执行；项目为empathy模板、组织为Mermaid。消息读回、来源保存/读回、handoff和Board均使用真实API，无HTTP拦截，正在验证。

边界：组织场景列现有组织Board库（不扩展权限查询语义）；本次消息fixture只提供生成后置条件，不执行模型、不证明生成质量；从真实消息读取开始覆盖持久化链路。尚未创建PR或部署。

真实浏览器还发现同一Board重选清空preview但不触发effect的问题；一行同值守卫修复，菜单交互回归真实red 1失败/16通过→通过，最终UI62项通过。最新独立复核无actionable问题；浏览器重跑中。

全栈浏览器完整通过（1个用例覆盖项目empathy与组织flowchart，25.3秒用例/4.6分钟含构建）。源码保存→真实revision→handoff顺序、取消零写、组织跨页、坐标与原内容、打开和刷新持久化均通过；截图与JSON已归档。截图复核显示大模板仅部分进入默认视口，补齐打开链接聚焦新内容后将再次验收。

聚焦接线完成：URL只携带实际artifactId/layoutHash，Board从已授权canonical对象解析真实bounds，复用既有fit/insets，只在身份/对象/视口恢复准备好后聚焦一次，不选择对象或写Yjs。最终UI12文件72项通过。增强浏览器验收预置pan=100000旧视口，并通过实际Fabric object-scenes/zoom/pan检查所有新增对象完全位于画布视口内（打开+刷新），正在跑。

最终聚焦浏览器验收通过：24秒用例/4.7分钟含生产构建。项目empathy与组织flowchart均在预置pan=100000旧视口后，以真实Fabric bounds/zoom/pan确认全部新增对象完整位于可视画布内；刷新重复检查通过。最终截图替换为focus后证据。额外sequence helper边界经独立review发现，修正为匹配main来源集合后纳入lifeline/return，定向red→green，完整UI最终12文件73通过；浏览器场景限定canvas/flowchart，sequence helper由unit验证。

最终静态门控35/35通过；首次指出两处新增测试类型问题（Testing Library不接受Playwright exact选项、hidden数组推断过窄），仅修测试类型与选项后，handoff17和focus7复跑通过。无产品源码变更。
