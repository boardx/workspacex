# W07 上下文方法包

WX-S001 knowledge-grounded-answer、WX-S008 meeting-preparation、WX-S011 internal-communications、WX-S014 project-status-report。固定版本官方来源与许可逐包保留。复用方法并替换成实际 WorkspaceX 只读工具，不安装 Notion/Slack 或发信引擎。

构建：`pnpm exec tsx skills/standard-context/scripts/build.ts`。
验证：`pnpm exec tsx skills/standard-context/scripts/verify.ts`。

使用现有 FileSkillStarterPackSource 分发 `standard-context/1.0.0.json`，部署须配置 `SKILL_STARTER_PACK_ROOT` 指向 `skills/starter-packs` 并通过既有导入/固定版本流程装配。源码包存在不代表已给所有终端用户部署。这里只验证包读取、字节、digest 和篡改拒绝；未宣称真实模型 G-SKILL 全项通过。

当前知识工具仅支持授权范围内已抽取附件，实际内容 digest 标识版本。完整组织知识、五路召回、过滤器/分页、不可变画布原文、引用专用 UI 尚非本包已交付能力。零命中与依赖失败分别报告，不造链接、不绕撤销、不代发邀请或公告。
