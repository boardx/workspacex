# 访谈阅读布局重构（#5250）

从最新 origin/main 492a9dc14 创建 codex/interview-reading-layout，复用当前 session 的唯一 worktree。

布局使用既有语义色：288px 专家列表，中文与英文别名分层，右侧统一阅读面板。20px 主标题、18px 问题层级、16px 正文与1.9行高；移动端上下排列。移除导航说明和多层卡片边框；技术 ID 模板标题容忍括号后的空格。原始 canonical Markdown、归属锚点、状态计数及报告就绪门保持。

验证：init.sh 快速路径通过；访谈记录 UI 20/20；web typecheck、lint 通过；标准隔离生产构建 Chromium 用例 1/1，覆盖稳定归属切换/刷新、1440px 宽屏长英文角色、390px 手机无横向溢出。截图在 /private/tmp/wsx-interview-5250；使用合成 UI 内容，不宣称外部模型证据。自有测试栈 wsx-f551769fb43738ab23d3 经标准包装器清理，完成前再次精确检查。

CI 与 PR 状态需读取 GitHub 当前事实，当前不声明部署。
