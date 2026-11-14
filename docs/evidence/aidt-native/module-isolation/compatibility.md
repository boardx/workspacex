# AIDT 独立模块兼容性检查

目标是让现有功能在关闭 AIDT 时保持原有入口与行为；启用 AIDT 时只增加明确声明的教学入口和适配。功能开关不是授权，服务端原有项目、资源和成员权限仍须执行。

## 检查范围

| 检查 | 关闭模块 | 开启模块 |
| --- | --- | --- |
| 普通 Chat 空态 | 原有任务模板、实际材料/技能计数、个人范围和简报保留；点击只调用原模板回调 | 同样保留，不进入教学模式、不添加学生结论 |
| 普通 general/workshop 项目 | 首页卡片与 `/projects/:id` 路由保留 | 同样保留；workshop 上同名标签不将其改成 AIDT |
| 历史 AIDT 标签项目 | 仍能从普通项目卡片进入 `/projects/:id`，不因关模块丢入口 | 由独立入口测试验证教学路径 |
| Studio 返回 | 忽略残留 `aidtStep`；普通 `step` 查询仍按普通项目研究返回 | 只有明确 AIDT 返回标记才进入教学步骤，普通 `step` 不被劫持 |
| 桌面导航与角色可见性 | 不显示 AIDT；普通 Chat/Project 保留 | 增加 AIDT；原有条目顺序、链接和治理权限过滤相同 |

行为回归文件：`apps/web/tests/ui/aidt-module-compatibility.test.tsx`。它与既有 Chat、普通项目列表及普通项目对话组件测试一起运行。测试使用组件及 API 替身，不等于真实后端或课堂验收。

## 依赖门禁

`apps/web/tests/aidt-module-boundary.test.ts` 解析生产 TypeScript/JavaScript 的 import、re-export、动态 import 及 require。它检查真实源码，而不依赖注释或搜索到的字符串：

- AIDT 实现集中在 `apps/web/features/aidt/{components,lib}`。
- 对外只暴露纯域/配置 `public.ts` 与 `entry/home`、`entry/workspace`、`entry/board-return` 三个 UI 适配入口。
- 旧 `lib/project-aidt.ts`、`lib/aidt-module-config.ts` 仅能 re-export 公共入口，不保留第二套实现。
- 原生 Chat、录音、Design 是被教学模块消费的能力，不能反向导入 AIDT，也不能通过旧 facade 绕过边界。
- `public.ts` 的传递依赖不得包含 UI、React/Next/Chat SDK 或 live API 适配器。
- 扫描必须实际包含已有 Chat 与 AIDT 模块；缺模块或扫描为空时失败。
- 门禁自身带非法私有 import、相对路径、动态 import、facade 回流和合法入口反例，防止扫描器静默漏掉依赖。

经根 agent 确认的入口白名单是：`app/aidt` 两条路由、`app/studio/board/[boardId]/page.tsx`、导航注册、两个薄 facade、首页卡片与区块、桌面壳和移动导航、普通项目列表、创建表单、资源返回面包屑。TeamTextConversation 与 WorkspaceCommunicationActions 保留在 shared，因为它们是整体产品的成员沟通能力。

## 执行命令

```bash
WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web exec vitest run \
  tests/aidt-module-boundary.test.ts \
  tests/ui/aidt-module-compatibility.test.tsx \
  tests/ui/chat-task-workbench-empty-state.test.tsx \
  tests/ui/projects-screen-live.test.tsx \
  tests/ui/project-conversations.test.tsx
```

最终退出码与测试数量由本轮实际结果补充。模块目录搬迁由根 agent 统一执行；搬迁未完成时架构门禁应失败，不以放宽白名单掩盖未收拢实现。

## 当前实测结果

2026-11-15（北京时间）：兼容行为新用例 10/10，通过；与既有 `chat-task-workbench-empty-state`、`projects-screen-live`、`project-conversations` 一起运行共 4 文件、38/38，通过，退出码 0。日志：`/tmp/aidt-module-compatibility-fixed.log`。

新增两份测试文件的 ESLint 通过，退出码 0。AST 扫描器的非法依赖/合法入口反例自测 1/1，通过；该次用 `-t` 明确只运行扫描器自测，另外三个真实目录门禁未执行，不能将其计为模块架构已通过。目录门禁须在根 agent 完成搬迁后运行全文件。

## 搬迁后的最终复测

根 agent 完成模块目录收拢后，依赖门禁与兼容行为组合实跑 **5 个文件、42/42 通过，退出码 0**：`/workspace/scratch/aidt-module-isolation/compatibility-final.log`。其中 4 个架构用例执行了真实生产目录扫描、facade 单源检查和公共入口传递依赖检查；不是只运行扫描器自测。

第一次搬迁后检查曾有 1 个负例失败：机械路径替换把测试中故意越界的私有组件 import 改成了合法 entry。已恢复该非法私有 import，保留既定白名单和所有真实目录断言，没有通过放宽门禁修复测试。最终私有 import 负例再次以单独全文件门禁复测确认；该记录仅说明测试夹具修复，不是生产边界越界。
