# UIUX 审计（2026-07-30）—— 结论摘要

> 完整正文由 UIUX agent 返回在会话里，**它按「只读、不写报告」约束没有落盘**。
> 本文件是 main coordinator 摘录的**结论与证据**，供签核与修正使用。
> ⚠ 该 agent 自陈**只实际看了 12 张截图（约 3%）**、dev server 编译成功但沙箱内无法 HTTP 点击。
> 所以本报告的强项是**跨域一致性与源码级判定**，弱项是逐屏视觉核对。

## 阻塞签核（5 条 + 1）

| # | 问题 | 证据 |
|---|---|---|
| 1 | **v2 签核路由在左栏导航里一个都没有**；`navigation.ts` 的「访谈/原型/研究」指向 `/studio/*` 的**另一套旧组件** | `apps/web/lib/navigation.ts` |
| 2 | **同一概念两套活实现并存**：`components/interview/`(`/studio/interview`) vs `components/itv/`(`/itv`)；`components/studio/prototype-screen`(单栏 825px) vs `components/canvas/`(三栏) | 两组路由都在 |
| 3 | 共享 `TopBar` 因 `resolveProjectContext` 只认 `/projects/*`，在所有 v2 预览路由上**恒判「不在项目上下文中·项目角色不适用」**，与满屏项目内容矛盾，逼得每域各画一套四视角切换器 ⇒ **全仓两套角色切换系统** | `lib/project-context.ts`、`components/shell/top-bar.tsx:55` |
| 4 | **`agent-runtime` 完全不套 `AppShell`**：无图标栏、无顶栏、无环境态条，裸浮在 `max-w-5xl` | `components/agent-runtime/runtime-shell.tsx:44` |
| 5 | **`files` 七态只替换中栏**：左树文件计数与右栏 PDF 预览始终显示真数据 ⇒ **denied 时泄露存在性**，观察者右栏能看到并可「下载原件/删除」机密文件 | `components/files/files-app.tsx:245-267` |
| + | `asset-governance` 第 11 束**零截图零组件**，当前不可签 | 目录空 |

**#1 + #2 + #3 是同一根病**：签核材料活在与产品导航脱节的**平行预览路由**上。

## 会返工（7 条）

- **itv 观察者是假降级**：主题×证据矩阵（P-04…P-12、每条证据）与研究员**一模一样**，只加了只读 banner（`uc-6-5-洞察报告-观察者视角.png`）
- **canvas observer 弱降级**：只去掉两个按钮，「AI 直接落笔」开关在 observer 下仍在场
- **`dep-failed` 约 40 屏无 `retry`**，仅约 11 屏有；跨域缺口不一
- **响应式**：只有 `itv-v2` 抓了 375；其余十域只有桌面档
- **环境态条「会议转录中 28:14」是全局静态 mock**，出现在治理页、后台蓝本页等非现场屏
- **rec 编号冲突**：P-10=Weber vs 既有 P-10=陈涛；「访谈 11」vs「访谈 10」
- **AI 便签权限三粒度**（模板级/项目级/画布级）各给默认值，求交语义未定

## 记录（6 条）

skill 试跑两套并存 · chat/tpl 归属未定 · 可见范围枚举增殖 + 议程用词三套（环节 264 / 阶段 16 / 步骤 27）· 顶栏组织切换器是裸 `<select>` · 各域截图视口宽不一（2720/2800/2880）· tpl confirm 的「有阻断项·无法发布」用 primary 绿而非禁用态

## 它认为做得好的（避免全是问题的偏置）

- **七态单一实现**：`state-shell.tsx` + `lib/ui-state.ts` 把 testid 收敛为保留名单源，并显式记录「曾声明两处」的教训——**本仓做得最扎实的一块**
- **身份/契约单源**：`lib/identity.ts` 全量 `z.infer`，`VisibilityScope` 同名冲突按纪律**改名而非合并**
- **org-admin 四视角是真降级**（脱敏聚合 vs 明细），可作其余域的模板
- **危险动作**在 tpl/skill/canvas 均有二次确认 + 影响范围 + 阻断清单
- **invalid 文案可操作**（files 导出超限给出分批建议）
