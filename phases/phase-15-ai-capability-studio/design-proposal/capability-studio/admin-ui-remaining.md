# 管理体验签核前补齐清单

依据独立云任务“工作台设计交付”对ef00ded9的核对与runtime-ui-interactions.md，本表只记录本轮既定范围。已有原型均使用模拟状态，不能替代生产API或真实浏览器证据。

| 项目 | 已有可审阅交互 | 仍需补齐 |
|---|---|---|
| Model配置 | single模型配置弹窗、provider/upstream/endpoint、临时凭据、载入/当前revision、保存后重测 | composite只读成员和现有EntityCatalog详情接入 |
| Model并发冲突 | 模拟其他管理员保存、保留非敏感修改、清空凭据、加载最新或明确重新审阅、冲突期间禁止测试/启用 | 真实浏览器焦点和生产CAS往返 |
| 连通与五项准入 | 五项名称、当前revision结果与历史、配置变化后旧结果失效 | 独立连通结果卡、三种判读、必填evidence、过期返回显示 |
| Model启停影响 | 启用前五项门、简单停用模拟 | 真实引用清单/未知数量、interrupt/drain确认、组合阻塞成员、选择器刷新 |
| MCP凭据重连 | keep/replace/clear原生单选、无旧凭据禁用keep、替换密码框、clear确认、失败清空输入保留端点/授权、端点变更更新连接CAS | 真实重连与版本冲突返回，不以本页模拟结果替代 |
| MCP发现差异 | 新增工具未授权 | added/removed/signatureChanged/tightenedByCapRecheck分类、被移除工具引用提示 |
| MCP权限范围 | 逐工具演示授权与撤权 | 既有ToolAuthScope选择、服务器上限/副作用约束、评审与连接状态独立展示 |
| 运行失败返回 | 失败区与回工作台入口 | 只按服务端引用导航、历史/当前revision并列、按MCP快照展示、无权限态、不自动重放 |

复用现有platform-admin目录、卡片、详情结构和DisableDialog；新增交互先留在preview。共享组件或生产页面接线必须纳入正式feature，不为赶签核直接改变未批准的生产行为。
