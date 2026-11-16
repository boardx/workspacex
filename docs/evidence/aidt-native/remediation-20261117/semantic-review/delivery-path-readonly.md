# 已有 WorkspaceX 启用 AIDT：只读路径核查

这是源码与现有文档核查，没有启动实例、查询生产、修改配置、发布技能、创建 Agent 或写入凭据；不证明用户电脑当前已满足条件。核查依据为本分支实际实现，不能用单个测试组织内 `skills=[]` 外推平台目录为空。

**审计时点说明：**下文核查发生于后续新 release 之前，保留当时的 summary 1.0.1 坐标作为历史审计，不代表最终默认版本。此后提交 `5411f3245` 已将 summary 默认升级为不可变 1.0.2，methods 仍为1.3.2；实际新 seed/pin 见 [summary-compact-skill-setup.json](../a1/summary-compact-skill-setup.json) 及相应运行窗口回执。旧 summary 1.0.1 和两次失败审阅记录保留；新默认包、实际线程固定版本和模型语义验收各自核对，不能互相替代。

## 正常进程是否自动准备并发布技能

**是，有明确前提。**后端 [aidt-module.ts](../../../../../apps/api/src/infrastructure/aidt/aidt-module.ts) 固定 opt-in 坐标为 `aidt-methods@1.3.2` 和 `aidt-project-summary@1.0.1`；仅精确环境值 `ENABLE_AIDT_MODULE=1` 或 `true` 启用。

[main.ts](../../../../../apps/api/src/main.ts) 的真实 API 进程入口在 listen 后调用 `ensurePlatformSkillCatalogSeeded`。当 `KERNEL_PLATFORM_SKILL_SELFHEAL` 不等于 `off` 时，该入口经 [ensure-platform-skill-catalog.ts](../../../../../apps/api/src/infrastructure/skill/ensure-platform-skill-catalog.ts) 调用 [ensure-standard-skill-packs.ts](../../../../../apps/api/src/infrastructure/skill/ensure-standard-skill-packs.ts)；启用 AIDT 时把两包加入已有标准目录导入流程，导入目标是 `org-platform`，不是当前学生组织。包有固定幂等键，重启不等于重复创建同内容。

[实际导入仓储](../../../../../apps/api/src/infrastructure/skill/pg-skill-starter-import-repository.ts) 创建 `status='enabled'` 的技能/版本及文件，调用 `wave2_publish_skill_version` 发布。升级沿同包成功导入血统增加不可变发布版本；不能靠直接编辑旧版本升级。源码自带的包文件为 [1.3.2.json](../../../../../skills/starter-packs/aidt-methods/1.3.2.json) 与 [1.0.1.json](../../../../../skills/starter-packs/aidt-project-summary/1.0.1.json)。

实际进程仍须能读取包目录并有正常数据库种子权限。[FileSkillStarterPackSource](../../../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source.ts) 的普通开发默认读取仓库 `skills/starter-packs`；已部署/打包环境应沿现有 `SKILL_STARTER_PACK_ROOT` 指向实际随包发货目录。API 自愈的包读取有仓库相对兜底，**不代表生产 DI 的显式导入根配置可省略**；生产显式导入 API 没有配置 root 时会如实缺包。

API 监听成功不证明 seed 成功。入口对每包失败写 `standard skill pack seed failed (will retry on next boot): <id>@<version>`；总体目录失败也只记日志，不使 API 启动失败。应核对两个包无失败，及登录身份的实际可见目录。`createApp()` 被测试/自定义宿主导入不等同真实进程入口；显式关闭 self-heal 的宿主须使用已有 owner 种子路径。

WorkspaceX Local 是这个例外的已实现路径：[seeds.ts](../../../../../packages/local-runtime/src/seeds.ts) 在 owner phase 每次运行 `backfill-standard-skill-packs.ts`；该脚本仍用相同 optional pack 解析。Local 的 API 设置 self-heal=off 是避免 app_rw 种子写入，不表示 AIDT 无法准备。其 [config.ts](../../../../../packages/local-runtime/src/config.ts) 根据 profile 明确覆盖开关：default 为0，aidt为1，不能仅在父终端设置 `ENABLE_AIDT_MODULE=1` 就假定普通 default Local profile 继承。

## 已有正常 WorkspaceX 的准确使用路径

1. 使用包含上述不可变包与当前 AIDT 实现的同一交付版本，保留原有可用模型/Agent/数据库配置。在现有 API 启动配置中设 `ENABLE_AIDT_MODULE=1`，按原方式正常重启 API；不要为此另建工程栈或把整份 CN 配置 source 进新环境。
2. Web 在**构建期**设置 `NEXT_PUBLIC_ENABLE_AIDT=1` 后用现有 WorkspaceX 构建/启动流程；旧产物只改运行环境并重启不会改变 Next 公共开关。若需要全局成员文字，同时设置独立的 API `ENABLE_PROJECT_MEMBER_CHAT=1` 与 Web 构建期 `NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT=1`。这些开关不授予权限、额度或模型能力。
3. 登录并选择有权限的组织，打开现有站点 `/aidt`（[路由](../../../../../apps/web/app/aidt/page.tsx)）；没有正确 Web 开关会 404。在 AIDT 首页按已有权限创建“新建小组空间”或进入已加入小组；[首页](../../../../../apps/web/features/aidt/components/aidt-home.tsx) 对无组员明确请教师/负责人添加。
4. 进入每一步的原生 Chat。用户不必逐一手工挑选六个教学 Skill：[live-aidt-step-chat.ts](../../../../../apps/web/features/aidt/lib/live-aidt-step-chat.ts) 用当前身份请求 `GET /skills?orgId=...&entry=library`，找到该阶段平台 stableName 的已启用、已发布版本，创建/恢复小组共享线程并挂载，随后回读确认。报告入口同法挂载 `dt-summarize-project`。此过程不创建 Agent、不改变已有 Agent/模型选择，不补充钱包额度。
5. 原线程保留旧固定版本；[现有更新 UI](../../../../../apps/web/features/aidt/components/project-aidt-chat.tsx) 在目录确有新版时显示“使用新版另开本步对话”，成功准备后显示“打开新版对话（新标签页）”。不要告诉用户刷新就会覆盖旧线程版本。

六阶段平台 stableName 分别为 `aidt-understand`、`aidt-empathize`、`aidt-define`、`aidt-ideate`、`aidt-prototype`、`aidt-iterate`；报告为 `dt-summarize-project`。包坐标不等于线程固定的数据库 versionId，应以挂载回读及来源回执核对。

## 为什么 tenant 内空技能列表不能证明缺失

[PgSkillContractRepository.listAll](../../../../../apps/api/src/infrastructure/skill/pg-skill-contract-repository.ts) 查询当前组织 **或** `org-platform` 的 enabled 技能，并取已发布版本。只有 `org-platform` 行输出 `platformStableName`；当前组织中同名行该字段为 null。[listSkills](../../../../../apps/api/src/application/skill/list-skills.ts) 随后按当前实际成员权限过滤，`entry=library` 是调用方标记，不改可见性规则。

因此 SQL 只查测试 org 的 skills 得0，只证明该 org 没有私有行；必须查看当前身份实际 `GET /skills` 中的可见平台行，或在授权只读运维层分别核对 platform 包导入和已发布版本。反过来，平台 rows 存在也不能跳过当前身份权限、线程挂载、模型或资金检查。

## 现有缺失提示、导入 UI 与真缺口

[AIDT 解析器](../../../../../apps/web/features/aidt/lib/live-aidt-step-chat.ts) 缺少平台技能时报告：“本步骤的 AIDT Skill 尚未安装或启用，无法开始教学对话。”[错误 UI](../../../../../apps/web/features/aidt/components/project-aidt-chat.tsx) 仅有“重试”“返回本步对话”，有多线程时列共同选择；这里**没有安装、导入或管理员跳转按钮**，不能在指南里虚构。

现有确有“导入 starter pack”按钮，但位置是 `/org-admin/skill?screen=catalog` 的目录页：[OrganizationAiCatalog](../../../../../apps/web/components/admin/organization-ai-catalog.tsx) → [CapabilityCatalogScreen](../../../../../apps/web/components/admin/capability-catalog-screen.tsx) → [SkillStarterImportPanel](../../../../../apps/web/components/admin/skill-starter-import-panel.tsx)。当前组织管理员可填写 Pack ID、Pack version 并点“确认导入”；前端可见性不替代服务端管理员检查。[controller](../../../../../apps/api/src/interface/controllers/skill-starter-import.controller.ts) 以 principal 的当前 org 导入，不能随表单指定成 org-platform。

**重要限制：**把 AIDT 包导入普通 tenant 并不使其自动变成 AIDT 宿主所需的平台行；tenant 行 `platformStableName=null`，宿主不会仅凭同名技能匹配。故该按钮不是“平台 AIDT seed 失败”的通用自助修复路径。普通用户也不应被指引去变更角色或导入服务账号。

`/platform-admin/skill` 的实际路由现在使用 [PlatformAiCatalog](../../../../../apps/web/components/admin/platform-ai-catalog.tsx)，不是旧 CapabilityCatalogScreen；其确有平台运营权限检查和目标组织选择，但**没有上述 starter-pack 导入面板**。不能凭旧组件仍存在就写成平台后台有该按钮。正常已启用实例优先沿现有自动平台 bootstrap；若该流程失败，先按日志核查随包文件/root/现有种子执行权限，由既有运维流程处理，不新增服务或绕过授权。

以上与 [AIDT-LOCAL.md](../../../../development/AIDT-LOCAL.md) 的两种本地工具边界一致：持久 `aidt:local` 不接收 CN 云密钥；`aidt:real-model:dev` 是退出清理的独立工程验收。用户已有正常模型配置的 WorkspaceX 可以启用现有模块，不应把独立工程栈误写成唯一试用路径。
