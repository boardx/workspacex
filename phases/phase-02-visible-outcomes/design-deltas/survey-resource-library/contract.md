# Survey 资源库入口设计增量

Status: confirmed by human in the coord-survey conversation on 2026-08-13.

本文件是本次 Survey 入口与资源库 UI 增量的唯一规范来源。既有
`contracts/survey/` 与 `design-deltas/survey-continuous-document/` 保持不变。

## 1. 信息架构

- `/studio/survey` 不再自动跳转到固定问卷，直接呈现“问卷与模板”资源库。
- 左侧只有两个一级资源入口：`问卷列表` 与 `模板列表`；右侧内容随当前入口切换。
- 左侧入口负责资源类型切换，不承担问卷或模板编辑职责。
- 默认进入 `问卷列表`；通过 URL 查询参数 `tab=templates` 可直接进入模板列表。
- 当前列表的搜索、分类/状态筛选与排序只作用于当前资源类型。

## 2. 问卷列表

- 右侧用可点击卡片展示问卷名称、状态、题目数、报告章节数、更新时间及可用的回收进度。
- 点击问卷卡片进入 `/studio/survey/:surveyId?step=design`，打开现有五步问卷工作台。
- `新建问卷` 与 `从模板新建` 作为列表页主操作保留；本增量仅实现 mock UI 与入口，不声明真实创建接口。
- 问卷快速筛选包含全部、草稿、回收中、已完成。

## 3. 模板列表

- 右侧用可点击卡片展示模板名称、分类、题目数、报告章节数、更新时间及被用于创建问卷的次数。
- 点击模板卡片进入独立模板编辑路由 `/studio/survey/templates/:templateId`，不得跳入某份问卷工作台。
- `新建模板` 与 `新建空白模板` 作为模板列表操作保留；本增量仅实现 mock UI 与入口，不声明真实创建接口。
- 模板分类包含全部模板、组织诊断、团队协作、客户反馈。

## 4. 返回路径

- 问卷工作台的“返回列表”返回 `/studio/survey`，并显示问卷列表。
- 模板编辑页的“返回列表”返回 `/studio/survey?tab=templates`，并显示模板列表。
- 浏览器前进/后退时，资源类型与 URL 保持一致。

## 5. 页面状态与响应式

- 资源库必须提供 loading、empty 与 error 三态的稳定 `data-testid`。
- 卡片、筛选与切换入口必须有键盘焦点态；当前资源入口使用 `aria-current="page"`。
- 桌面端为左侧资源导航加右侧卡片网格；窄屏将资源入口收敛到内容顶部，不出现横向溢出。
- 问卷卡片和模板卡片使用稳定 ID 作为测试锚点，不以中文文案或 DOM 层级作为验收锚点。

## 6. UI 原型材料

- [问卷列表确认稿](./ui-preview/01-questionnaire-list.png)
- [模板列表确认稿](./ui-preview/02-template-list.png)
- [问卷列表实现截图](./ui-preview/03-questionnaire-list-implemented.png)
- [模板列表实现截图](./ui-preview/04-template-list-implemented.png)
- [独立模板编辑页实现截图](./ui-preview/05-template-editor-implemented.png)
- [375px 问卷列表实现截图](./ui-preview/06-questionnaire-list-mobile-implemented.png)

## 7. 验收场景

1. 访问 `/studio/survey` 时停留在资源库，左侧问卷列表高亮，右侧显示问卷卡片而非自动进入 `sv-1`。
2. 点击模板列表后 URL 变为 `/studio/survey?tab=templates`，右侧只显示模板卡片。
3. 点击问卷 `sv-1` 卡片进入 `/studio/survey/sv-1?step=design`。
4. 点击模板 `tpl-digital-collaboration` 卡片进入 `/studio/survey/templates/tpl-digital-collaboration`。
5. 从问卷工作台返回资源库时显示问卷列表；从模板编辑页返回时显示模板列表。
6. loading、empty 与 error 状态均有非空的用户可见反馈。

## 8. API 契约边界

- 本增量只新增 UI 原型路由与本地 mock 模型，不新增或修改真实 HTTP API。
- 资源卡片模型只服务于原型渲染，不对服务端持久化、权限或创建动作作保证。
- 后续接真实数据时必须复用 Survey 契约束的组织隔离与权限规则，不能把本地 mock 形状当作服务端契约。

## 9. 明确排除

- 不实现真实问卷/模板 CRUD、删除、复制、发布或持久化。
- 不修改现有问卷五步工作流内部语义。
- 不新增第三方依赖，不新增新的一级全局导航。
