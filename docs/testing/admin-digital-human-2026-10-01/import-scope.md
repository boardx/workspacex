# 官方角色导入的组织边界复核

针对 PR #4866 的独立复核修复。基于 0693632a08bfba025b8d531c375b27ac44dbf5fb；尚未部署。

原 helper 的反证：首个依赖 POST 后组织失效，仍发出第二个依赖与角色导入 POST，最后报告完成。见 import-scope-counterproof.log。

后台入口现在冻结启动时的组织与 bearer，每次 POST 前后检查当前组织/会话及取消信号，卸载时取消，不把取消后的 409 当作已具备。两条导入契约支持可选 expectedOrgId；服务端只将它用于和已解析 principal.orgId 比较并拒绝失配，绝不使用它选择 tenant。检查在任何 pack 读取、权限依赖或导入副作用前，随后剔除 expectedOrgId，业务用例继续仅收到 principal 组织。

已经到达服务端并在旧组织获得合法 principal 的请求可在旧组织完成；取消不回滚已完成导入。延迟到切换组织之后才解析的请求会拒绝。固定包坐标幂等键保持不变，允许重试已完成部分。

前端成功提示改为“官方数字人已启用”，不声称未等待的目录刷新已经成功。

验证：

- helper/后台 UI/目录/首页配置回归 38 项通过，最后 scope 前后检查补充后 helper+后台 UI 12 项再次通过。
- 6 项服务端/契约验证通过，包含真实 HTTP 经生产 PrincipalGuard、ZodBodyPipe 到 controller，在 auth resolve 暂停期间切换同一 session 的组织，两条 POST 均 403，所有 pack/导入依赖访问为 0。
- 此 HTTP 测试仅控制会话解析端口，无 PostgreSQL；已添加到受 DB-import guard 检查的精确 DB-free 文件允许列表。
- API/web lint 与最终串行 typecheck 均退出 0。并行 API typecheck 曾 exit 137，web 夹具类型检查曾发现 ApiError 少 raw 参数（已补）；失败轮次不计通过，成功串行日志见同目录。

范围边界：本修复接线的是新增后台入口，既有 chat picker 未传 scope 的调用保持兼容，须另行接线；真实浏览器、线上部署和专业角色效果尚未验收。
