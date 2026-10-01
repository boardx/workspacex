# S003 契约单源 CI 修复

统一 PR #4867，基于 95aea6866。CI 的 contract-single-source 在 API 本地 S003 Zod 定义的第 10/16/21 行发现三处违规。本地反证复现 1 项失败、3 项通过，未放宽单源门。

唯一 Zod 定义迁移至 packages/contracts/src/work-skill-evidence-ledger.ts，index 导出 workSkillEvidenceLedger。API s003-contract.ts 仅兼容 re-export，并使用现有 API zodToJsonSchema 将同一契约派生为 JSON Schema；contracts 新模块仅引入 zod，无新增 runtime dependency。生成器、loopback 和既有测试继续从该单源消费，who-knows 的 owner 约束及发货 schema 保持不变。

验证：contract-single-source 4 项与 S003 shape/owner/JSON Schema/CLI/引用 identity 7 项，共 11/11 通过；生成器 generate-s003-machine-contract.ts --check 退出 0，无发货 frontmatter 漂移。纯 FS 的 contract-single-source 精确登记为受 DB-import guard 检查的 DB-free 文件，无 PostgreSQL、Docker 或全量 typecheck。见同目录两份 s003-single-source 日志。

本次仅修 CI 单源约束；真实模型及浏览器验收状态不因此改变。
