# Sprint 21/03 当前边界

F03 owner coord-voice / #5729，in_progress。测试与证据见progress.md。当前只有钱包查询，不把入口/查询视为支付完成。首次组合hook超时原因未证实，保留反证；诊断与最终组合均退出0，没有提高timeout或弱化断言。

F02配置作为依赖分支带入本工作分支（其PR5716已全绿但未main），F03 PR应以worker/coord-voice-21-f02为base，待5716合并后按真实main血统重核并改base，不能将F02冒充F03的新实现。一session仅复用当前worktree。未修改确认签核status，F03编号及covers由claim机械分配。

正式验证：pnpm harness verify --sprint 21/03 --feature F03。只做当前F03，完成后再按已授权总体目标推进订单/回调/订阅/token结算。源文件保持单一DB/身份仓储注册，不能在Billing里另起池或绕过PrincipalGuard。资源已释放。
