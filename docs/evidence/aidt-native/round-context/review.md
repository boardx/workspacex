# 保留已保存反思轮次

## 问题与修复

学生在第六步保存本轮学习并选择返回前序阶段后，原生 Chat 完成线程加载会改写 URL，丢弃 returnRevision。工具与资料导航、Chat Artifact 到 Board 的返回链接也没有保留该值。历史记录没有被删除，但页面失去了本轮返回依据。

修复集中于 features/aidt：aidtHref 显式支持返回轮次；原生 Chat 初始化、切换会话、错误重试和显式另开新版 Skill 对话都保留同一小组、同一步的上下文；成果、交接、设计、个人笔记及原始证据入口持续携带该轮次；Board 往返只重建当前项目和实际 Board 资源的白名单 URL。手动切换阶段或其他小组不继承旧标记。Dashboard 未确定阶段时不猜测轮次与线程绑定。

URL 中的轮次仅是导航引用，不能代表授权、有效证据或完成状态。既有第六步历史查询仍校验项目、阶段、修订、学生确认及返回目标。重复或不安全的 Board 返回参数不生成教学返回入口；Board 自身权限保持原样。

## 已执行检查

- 先以失败测试复现：原生 Chat 线程加载后 returnRevision 应为 3，实际为 null。
- 4 个相关文件的 83 项回归通过；包含真实 ChatHostNavigationProvider 的 Board 返回上下文、跨项目／步骤不继承、新版 Skill 链接、资料和工具入口。
- 50 个 AIDT Web 测试文件、501 项测试通过。
- Web 类型、变更文件 ESLint、设计扫描通过。
- 仓库 tick 因未配置 COORD_GATEWAY_URL 失败，未声称取得协调租约或 CI 通过。

真实本地新构建与持久回读结果见本目录后续 native 证据。组件测试中 API 与 Chat shell 使用受控替身；不能据此声称模型、Board 服务或课堂验收已经通过。历史 MBA 文档的边界见 source-intake.md。


## 停机复验发现并修复

首个新构建成功（244.814秒）且已通过真实浏览器的返回轮次、工具及刷新检查，但在第一次 stop 时，原启动进程退出1；该次完整E2E判失败，证据见 shutdown-failure.json。检查发现 pglite-socket 的 stop 对 detach 不等待，迟到的断线回调仍可访问已关闭数据库。现有 SessionAwareQueryQueue 增加关闭屏障：拒绝新排队、结束活动SQL、等待已有事务清理，再断开socket和关闭DB；关闭后的detach不再访问DB。不屏蔽进程错误、不放宽owner退出码断言，也不改数据库角色或权限。

38项本机数据库/队列/停启测试及Local Runtime类型检查通过，包含真实PGlite活动SQL排空、等候工作拒绝、关闭后detach与原有多客户端命名／事务隔离、RLS及A+B持久化。因本机运行源码发生变化，需重新构建后再跑完整双停启；不复用上一份源码指纹不匹配的产物。
