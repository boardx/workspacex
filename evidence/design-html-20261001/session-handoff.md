# 会话交接

工作区 /private/tmp/wsx-design-html-acceptance，分支 codex/design-html-acceptance，GitHub issue #4902。

用户已授权读取主仓本机配置文件，向真实 DashScope 发送虚构情绪日记测试内容。配置值不进仓库/聊天；测试栈 scripts/local-session/design-html-stack.mjs 只有显式 --model-config 才读配置，不发现/管理本机 Ollama。

用户测试栈保留：Web 127.0.0.1:3192，API3292，PGlite55992，数据 /private/tmp/wsx-html-data。账号信息在 /private/tmp/wsx-html-user-login.txt（0600，不入库）。生成的真实项目 ID 006d9395-5649-4471-91ab-fc9554534a0f。

本次无 Docker 栈。测试用3199的临时Playwright服务由配置自动释放。主checkout大量他人改动未触碰。当前worktree与独立本地测试服务为用户验收保留；用户验收完后关闭该stack进程，它将按信号停owned children和PGlite，再回收本worktree。不要停其他会话3200或11434服务。

证据只用于对应验证层：fullstack/ 是真实API/模型/DB；browser-* 是page.route前端夹具。失败反证也保留。用户测试入口不是devapp或生产部署。
