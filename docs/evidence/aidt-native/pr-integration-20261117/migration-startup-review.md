# AIDT 最终迁移 / 启动 / 默认关闭只读复核

工作树 `/workspace/aidt-pr-20261117`，develop基线 `4060bcf2017ef5775b762f2135f22042f8a96d19`。初次复核HEAD `1a2ec212d38635a60b1337cc4a949ec564c0d7a8`，root最终修复尚dirty；最终提交SHA待root提供后核对。只读审查，不提供人类审批；未启动数据库、模型或发布，没有新增源码改动。

**代码审查结论：未发现新的P1/P2代码阻塞。发布前置仍存在：新API必须先获得匹配schema，模块关闭不能替代迁移。该前置不应被写成已验收或已授权执行。**

## 普通Chat对新schema的实际依赖

- `apps/api/src/infrastructure/chat/pg-chat-message-command-repository.ts:53` 普通消息重放查询无条件选择 `r.aidt_selector_hash`。
- 同文件`:195` 普通消息受理也向 `agent_runs` 插入该列，普通值为null。
- `apps/api/src/infrastructure/agent-run/pg-agent-run-repository.ts:201` queued run claim无条件RETURNING该列。
- 该列由 `20261116160000_aidt_run_context.sql:2` 新增，无默认值、旧行保持null。旧API不会引用新列；新API依赖新列。普通Chat关闭AIDT之后仍不能运行在缺少该列的旧schema。
- 新immutable trigger只针对该列更新且值确实变化时拒绝，旧/普通null marker无需事后回填，不改变普通run状态更新。

## 迁移及启动次序

本分支相对develop包含5个新migration：共享阶段、成员文字、课程、原始上传回执、上下文。主要为新增隔离表、约束、tenant FORCE RLS、最小app_rw grant与共享agent_runs nullable marker；没有业务表DROP或成员角色赋权。全局freeze/archive policy installer也被调用，故不能将其称为完全不影响共享数据库的“仅前端模块”。

- 本地runtime源码明确 owner阶段 `runMigrations` / `runOwnerSeeds` 完成，停止owner连接后才以app_rw启动API；本次未运行该路径，不替代PG升级验收。
- 真实API Docker镜像包含migrate-cli及迁移文件，CMD仅启动main.ts；API启动本身不是自动schema修复机制。
- 最新image-release以既有root-owned `workspacex-image-release` wrapper作schema preflight/route/verify/recover。PR没有改变schema admission，也未授权绕过拒绝。确切host可用性与schema handoff仍需发布阶段真实回执。
- 正确发布次序：独立审查和授权匹配exact SHA的schema release，受控执行并读回 → 部署匹配新API镜像 → 按既有授权核对API/module配置和浏览器。代码merge不等同上述数据库操作已授权。

## 默认关闭与Web opt-in

- `ENABLE_AIDT_MODULE` 默认off，仅1/true启用后端教学包导入；可选课程/阶段/文件/上下文服务按既有flag和ACL关闭。已导入能力不会因关闭flag而删除或撤权，这一限制已有README明确说明。
- `ENABLE_PROJECT_MEMBER_CHAT` 独立opt-in，成员文字不依赖AI run；默认off不改变实际成员/角色。
- 最终workflow草稿新增 `enable_aidt` 默认false，仅接受DevApp新tag；Web compile flags同时设为0/1并要求一致。该输入只编译Web，不设置API runtime flag，不运行schema迁移。新plan摘要明确“API runtime flags and schema admission remain separate”。
- 既有tag的Web flag没有构建证明，不能通过新的enable_aidt输入假装改旧镜像。生产/CN/US opt-in被plan拒绝；本次未运行workflow证明线上情况。

## PR必须如实记载的边界

本PR含5项待受控执行的schema migration；AIDT默认关闭仍要求新schema。合入develop不执行/授权迁移、app_rw grants或API flags变更。DevApp须先完成单独审查的exact-SHA schema release并取得回执，再部署新API。缺少schema handoff时发布gate应拒绝，不以关闭flag绕过。迁移/真实PG兼容性、模型及课堂验收未由本次只读或unit测试证明。

已将上述建议原文发送root；PR正文和最终SHA回读待补，不能在未读取前声称正文已包含。
