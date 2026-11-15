# AIDT A+B：本轮交付

范围依据：用户已明确同意共享阶段稿与版本冲突保护（A）、成员文字频道与单层话题回复（B），随后明确“先完成 A+B，访谈录音另排”。不将本轮交付解释为全部课堂 P0 已完成。

源码候选：`8f31b6fa4d94d74f0228df2367546b2782a06e27`；基线：`86c1092798575d4348d658a56063a8f32b478bb8`。六小时窗口为 2026-11-15 07:28–13:28 北京时间。小时是计划检查点，不将并行提前完成的工作称为六个小时已过去。

## 实现

- AIDT 保持独立的 `apps/web/features/aidt` 模块；入口 `/aidt`、小组 `/aidt/:projectId`，六步默认进入 WorkspaceX 原生 Chat，结构化成果通过 `tool=outcome` 打开。
- 阶段成果写入真实 PostgreSQL，重新进入可恢复，保留作者、时间、历史及来源版本。并发保存使用预期版本校验，冲突时保留本页内容；相同操作重试不会重复建版。
- 小组报告单独保存，引用实际已保存的阶段版本。报告保存不夹带尚未保存的第六步编辑；普通阶段保存也不会丢失报告。
- 成员文字沟通作为整体功能放在教学模块外，在已登录页面可通过统一入口打开；选择项目后可跨页面保持未发送草稿，关闭面板会暂停拉取。仅在面板可见且在线时约五秒增量同步。
- 人类频道不调用 Agent 或模型；消息有数据库接收回执、幂等重试与单层话题。回执不等于成员已读。未实现编辑、删除、通知及语音房。
- 图片选择复用原生项目公开线程中的已发送附件，读取使用授权服务；图片解码失败时不能伪装成成功预览或 PDF 图片。学生解释、真实引文、AI 推测仍明确区分。
- Board、Research、Design、Artifact、原生 Chat 使用原公共能力。跨模块保留小组、阶段、线程和安全返回位置；个人 Artifact 检查点继续只属于本人。

## 开关与兼容

四个开关默认关闭。Web 开关是构建时变量，API 开关需要进程重启；它们不授予任何权限。

```dotenv
NEXT_PUBLIC_ENABLE_AIDT=1
ENABLE_AIDT_MODULE=1
NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT=1
ENABLE_PROJECT_MEMBER_CHAT=1
```

新增两条迁移仅在隔离测试数据库执行；未操作生产。关闭功能不会删除历史数据或已安装技能。旧项目角色与既有服务权限规则保持，组外成员和非成员组织管理员不能获得新频道或阶段稿权限。

## 本地验证

`web-tests.txt` 为最终前端相关及原模块回归：53 文件、492 项通过；`api-unit-tests.txt` 为 7 文件、83 项无数据库测试通过。双端完整类型检查、contracts 类型检查、双端 lint 及模块显式 ESLint 均通过，完整输出在本目录。局部 Agent 数量重叠，不相加。

```bash
WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web test tests/ui/aidt tests/ui/project-aidt tests/ui/home-aidt tests/aidt tests/live-aidt tests/ui/team-text-conversation.test.tsx tests/ui/project-member-chat tests/project-member-chat tests/live-project-member-chat tests/ui/chat-task-workbench-empty-state.test.tsx tests/ui/create-project-dialog.test.tsx tests/ui/projects-screen-live.test.tsx tests/ui/project-conversations.test.tsx tests/ui/project-breadcrumb.test.tsx tests/ui/workflow-nav.test.tsx tests/ui/copilotkit-v2-composer-recording-send-gate.test.tsx tests/ui/copilotkit-v2-composer-accessible-name.test.tsx tests/ui/composer-draft-prefill.test.tsx tests/ui/chat-host-navigation.test.tsx tests/ui/chat-diagram-board-handoff.test.tsx tests/ui/browser-title.test.tsx tests/ui/chat-handoff-panel.test.tsx tests/ui/copilotkit-v2-shell-thread-switch.test.tsx tests/ui/project-collaborators-panel.test.tsx tests/ui/workbench-composer-draft.test.tsx tests/ui/copilotkit-v2-composer-recording-scroll.test.tsx
pnpm --filter @repo/api exec vitest run --config vitest.aidt-collaboration-unit.config.ts
pnpm --filter web typecheck
pnpm --filter @repo/api typecheck
pnpm --filter @repo/contracts typecheck
pnpm --filter web lint
pnpm --filter @repo/api lint
pnpm --filter web exec eslint features/aidt --ext .ts,.tsx --max-warnings 0
```

真实全栈命令、最终结果及边界见 [原生全栈验收](../native-fullstack-validation.md)。没有重新安装全套依赖；复用了现有已安装依赖，未改锁文件。

## 访问与后续

当前环境没有可调用的共享桌面或受控端口预览能力，不能提供已验证的用户应用链接。隔离测试的 `127.0.0.1` 只对该环境可达，不作为外部 Demo 地址。原生界面截图和源码包可审阅，截图页本身不是正在运行的应用。

访谈录音另排，语音房后置；实际麦克风、ASR、外部模型教学质量、图像生成服务及约 30 人课堂负载均未验收。报告支持 Markdown 下载与浏览器打印为 PDF，不声称用户取消打印后文件已生成。

未部署、合并或发布 PR。此前 GitHub 外发被自动审批拒绝，本轮未重试；协调网关未配置，不声称 CI 或仓库租约已通过。
