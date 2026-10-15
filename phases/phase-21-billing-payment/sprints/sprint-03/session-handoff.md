# Sprint 21/03 当前边界

F03 owner coord-voice / #5729，in_progress。测试与证据见progress.md。当前只有钱包查询，不把入口/查询视为支付完成。首次组合hook超时原因未证实，保留反证；诊断与最终组合均退出0，没有提高timeout或弱化断言。

F02配置PR5716现已合入main并部署，当前分支已同步main c0dcbb150，F03 PR直接base main，差异不包含F02的新实现。一session仅复用当前worktree。未修改确认签核status，F03编号及covers由claim机械分配。

正式验证：pnpm harness verify --sprint 21/03 --feature F03。只做当前F03，完成后再按已授权总体目标推进订单/回调/订阅/token结算。源文件保持单一DB/身份仓储注册，不能在Billing里另起池或绕过PrincipalGuard。上一轮自有验证进程与隔离栈已释放；保守端口quarantine不手删。

当前架构修正：纯适配器工厂模块在infrastructure/identity，不增加根级豁免；opaque cursor不定义第二份公共DTO。35项隔离回归通过。旧正式失败留下保守quarantine租约，缺完整后代退出证明未手删；无运行容器/旧验证进程。继续正式verify与独立审/CI，不能以已有专项通过代替全局结果。

当前钱包PR #5744仍draft。独立基线修复PR #5746已验证完整Web并合入当前分支，待主协调者CI绿后合入main以使F03差异回到仅钱包范围。最近正式run因已确认Web失败在API部分测试期间中断(exit143)，F03.verify.log仍旧架构失败记录，不能误读为本轮通过证据。新正式复验尚未完成，下一feature不抢先claim；下一个订单测试矩阵见/tmp/wsx-wechat-transport-notes-1015.md及审查消息，不能把本地临时材料视作已交付代码。
