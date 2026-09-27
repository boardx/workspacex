# Markdown 研究正文契约：任务 1 验证

范围：#4372，原型补齐计划任务 1。此改动是新增文档契约与只读 AST 投影，尚未切换数据库、模型调用或 UI；不声明全流程已使用 Markdown 单源。

- `./init.sh`：退出 0，快速依赖健康检查；不是全仓验证。
- `pnpm --filter @repo/contracts exec vitest run tests/interview-markdown.test.ts`：7 项通过。
- `pnpm --filter @repo/contracts typecheck`：退出 0。
- `pnpm --filter @repo/contracts test -- --maxWorkers=1 --minWorkers=1`：97 文件、944 项通过，退出 0。
- `git diff --check`：退出 0。

红绿证据：初次测试因契约模块尚不存在失败；空白文档 ID 测试出现 expected true to be false，增加非转换校验后通过；章节/条目/锚点测试因缺少投影失败，补齐后通过。

研究 Markdown 原文（含 CRLF、Unicode、GFM 表格及代码块）不作 trim/重写。AST 投影只用于阅读导航，不作为正文副本保存。模拟证据类型由受控元数据保持，不接受正文中的“已批准”宣称。此契约的哈希字段只做格式校验，持久化层必须计算和校验真实 SHA-256；不能把客户端提供的哈希当成真实性证明。

独立审阅发现空白 ID 与缺少章节/条目/锚点投影；分别新增失败测试并修复。引用仍需后端权限和版本校验，本解析器不授予权限。

没有启动 Docker 或浏览器服务器。后续任务仍需数据库迁移、API/模型切换、逐页 UI 与真实浏览器验证。
