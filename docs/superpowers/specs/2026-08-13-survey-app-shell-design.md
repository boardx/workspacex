# Survey AppShell Design

## Goal

在访问 `/studio/survey` 及其所有子页面时，持续保留 WorkspaceX 全局图标栏与 Survey 二级菜单，只替换右侧主内容区。

## Information Architecture

- 全局一级导航继续由 `AppShell` 的 `IconRail` 提供，“问卷”保持选中态。
- Survey 二级菜单固定包含“问卷列表”“问卷模块”“报告模块”。
- 列表路由在右侧呈现现有卡片、搜索、排序和新建操作。
- 问卷设计、问卷模块编辑和报告模块编辑仍在右侧呈现现有编辑器；进入编辑器不会移除两层左侧菜单。
- 移动端沿用 `AppShell` 的既有折叠策略，不新增第二套响应式规则。

## Component Boundary

- 新增 `SurveyAppShell`：只负责组装 `AppShell`、mock identity 和 Survey 左栏。
- 新增 `SurveySectionNav`：根据当前 pathname/query 标记三个入口的选中态并负责导航。
- 新增 `/studio/survey/layout.tsx`：为该路由树中的列表页、工作流页和报告模块编辑页统一套壳。
- `SurveyResourceLibrary` 移除自身的全屏顶栏与重复左栏，只保留右侧资源内容。
- 工作流与报告模块编辑器保留现有业务交互，但其根容器改为适配右侧内容区，不再承担全局页面壳职责。

## Behavior and States

- 点击全局“问卷”进入问卷列表，AppShell 不卸载。
- 点击二级菜单只切换右侧资源列表。
- 从卡片进入编辑器后，二级菜单继续存在；返回列表仍回到对应二级入口。
- loading、empty、error 状态仍只发生在右侧主内容区。

## Verification

- 组件测试断言 `app-shell`、`shell-rail`、`shell-left-panel`、Survey 二级菜单与右侧卡片同时存在。
- 路由级测试覆盖列表页、问卷编辑页和报告模块编辑页都经过统一 layout。
- 现有 Survey 29 项交互回归保持通过。
- Typecheck、design lint 与 diff-check 通过。

## Scope

只调整 Survey 页面壳层与导航归属，不改变 mock 数据、问卷问题、报告章节、保存逻辑或后端契约。
