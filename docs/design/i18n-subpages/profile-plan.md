# 个人资料国际化实施计划

Refs #6133。用户已明确按计划直接开发；直接交办切片，不创建/修改人类签核状态。

目标：沿用一期 useI18n() 语言偏好，让/profile完整展示中英文，保持用户名、密码、活动原文及API协议不变。

依赖：用户最新授权并行实施，已同步一期 #6134 的51567c468基础到独立二期分支；无需等待合入。模块资源独立文件，由一期确定聚合入口。不得实现第二套locale或provider。

1. 写UI行为测试：英文标题/显示名/密码/头像、空态和错误、切换时用户输入保持；先见红。
2. 独立profile namespace：中英文同一语义键集、插值，不翻译用户资料及事件summary。
3. 同步一期基础后接入profile各子组件，保存错误码/参数而非已翻译字符串，避免切换后旧错误语言滞留；语言变化不得重新请求活动或重传头像。
4. 本切片所需StateShell共享文案纳入资源；PaginationLoadMore传入本地文案。ThemeToggle由一期共享壳负责。
5. 验证：profile-mobile-actions与新i18n行为测试、web typecheck/lint、浏览器/profile zh-CN/en窄屏和表单旅程；不把UI mock当真实API成功证据。
6. PR显式目标develop，Refs #6133；CI及review跟进到绿。全量二期继续按审计十批逐issue/PR推进，不在本PR关闭整期issue。

阻塞边界：COORD_GATEWAY_URL缺失，tick尚不能登记；如仓库机械门拒绝，记录精确失败及文件，不代填签核。
