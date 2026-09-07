# 契约复用与差量边界

2026-09-07 用户指定另一工作台会话后，跨会话责任以 [peer-boundaries.md](peer-boundaries.md) 为准。本表列需求差量，不表示全部由本分支实施；公共事件、主 run 控制及工作台体验不重复建设。

历史契约是现有接口的权威；其 `confirmed` 只覆盖历史范围。本批次新差量依据用户对 v1.1 实施方案的直接授权记录，不改写历史签核字段。涉及新增公共契约的具体设计应先作为本目录差量材料审阅，再实现；不得用抽象需求扩大权限。

| 工作包 | 复用单源 / 实现 | 本次差量 |
|---|---|---|
| W01 | `packages/contracts/src/{kernel-gateway,agent-runtime,plan-permissions,streaming-transport,agent-interrupts}.ts`；已有 pytest/Vitest | 标准编号、来源与实际工具集合映射；实际交互约束差量；无第二权限或验收框架 |
| W02 | 现有 `apps/skill-sandbox`、文件上传/下载和对象存储 | 官方 Backend 的会话文件、附件只读、Python、恢复与取消 |
| W03 | `skills.ts`、`curated-capability-packs.ts`、`skill_version_files`、pins | 完整技能包物化和原生加载；子代理范围；新旧 run 版本切换 |
| W04 | `artifact.ts`、`artifacts-steering.ts`、`files.ts`、现有 AG-UI/HITL | 原生执行产物映射、失败和终态取消；暂停不等于取消 |
| W05 | 现有 MCP gateway、发现、凭据、安全状态与组织权限 | LangChain MCP adapter 的真实调用、动态分派和取消 |
| W06 | 官方 web-research Skill、LangChain 搜索集成和统一内核 | 凭据/来源/预算与完整技能包适配；不另建研究引擎 |
| W07 | `context-pack.ts`、`project.ts`、既有检索披露及项目 API | 工具包装、来源定位和四类写作模板 |
| W08 | 文件/附件权限和统一沙箱输入 | Docling loader、格式解析、位置引用和失败语义 |
| W09 | 四类 Office 创建与已有沙箱 | 完整包迁移、有限编辑/页级处理、渲染 QA；原来的创建签核不代表编辑已做 |
| W10 | LangChain MCP、Microsoft Playwright MCP、文件产物 | 隔离浏览器 profile、网页产物和真实交互测试 |
| W11 | 现有 canvas API、`packages/fabric-markdown` | Agent 工具入口和遵守对象身份的工作流 |
| W12 | LangGraph Store 和现有身份边界 | 用户长期记忆 namespace、读写删与撤销，不把 checkpoint 当个人记忆 |
| W13 | 支持的官方 cron 部署或单个 pg-boss 提供者 | 只触发现有 run，持久化/幂等；不另造工作流引擎 |
| W14 | `recording.ts`、`personal-realtime-transcription.ts`、现有图片 provider | 授权音频文件入口、标准工具/产物映射和转录/纪要/视觉包 |
| W15 | 技能文件/URL 导入、版本与审核 | Agent 输出完整草稿包；不得复活 `POST /skills`（恒 410） |
| W16 | 现有 `spawn_async_task`、队列状态机和前端面板 | 当前内存 store 的持久化、幂等、恢复、快照与取消 |
| W17 | LangChain SQL Toolkit | 只读连接、范围控制、结果上限；不硬依赖 W05 |
| W18 | 共享文件、沙箱和产物 | 数据分析与可视化包共享计算依赖，保留独特质量检查 |
| W19 | `interview.ts`、`research.ts`、现有 guided research | 研究方法包、参与者去重和可定位引文 |

## 历史设计与运行体依据

- `phases/phase-14-agent-kernel-unification/contracts/`：内核网关、流式传输、权限、产物与错误观察。
- `phases/phase-01-run-a-project/contracts/skills/`：历史技能版本/声明/绑定；不能推导完整任意代码执行已实现。
- `phases/phase-01-run-a-project/design-deltas/skill-office-docs-node-runtime/`：明确为四类从零创建；有限编辑仍是新增范围。
- `apps/api/src/interface/controllers/skill.controller.ts` 与 `packages/contracts/src/skills.ts`：冻结草稿创建 HTTP 入口。
- 既有测试可复用；每次验证记录真实基线与命令，不能引用历史通过记录当作当前验收。
