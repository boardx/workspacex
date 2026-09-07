# W07 上下文方法包

WX-S001 knowledge-grounded-answer、WX-S008 meeting-preparation、WX-S011 internal-communications、WX-S014 project-status-report。固定版本官方来源与许可逐包保留。复用方法并替换成实际 WorkspaceX 只读工具，不安装 Notion/Slack 或发信引擎。

构建：`pnpm exec tsx skills/standard-context/scripts/build.ts`。
验证：`pnpm exec tsx skills/standard-context/scripts/verify.ts`。

使用现有 FileSkillStarterPackSource 分发 `standard-context/1.1.0.json`，部署须配置 `SKILL_STARTER_PACK_ROOT` 指向 `skills/starter-packs` 并通过既有导入/固定版本流程装配。源码包存在不代表已给所有终端用户部署。这里只验证包读取、字节、digest 和篡改拒绝；未宣称真实模型 G-SKILL 全项通过。

1.1.0 更新四个方法的共同检索说明：默认 current-files；organization-index 为现有 primary-file-index 全文路径；organization-hybrid 需要服务端实际 embedding/rerank 配置。它不默认启用、不覆盖未索引资料、未接图种子或全访谈同意来源。旧 1.0.0 manifest 保留不可变，旧真实模型证据只适用于当时版本。完整组织覆盖、任意 filters/cursor、引用专用 UI 仍不在本包声明范围。零命中与依赖失败分别报告，不造链接、不绕撤销、不代发邀请或公告。
