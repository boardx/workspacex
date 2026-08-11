# 实时转录工作台 UI 待确认材料

本目录是 issue #945 的 UI-first 产物。当前只使用 `apps/web` 真实组件与本地 mock 数据，尚未连接创建会话 API、数据库或阿里云 Fun-ASR。

## 路由与截图

- 路由：`/rec`
- 历史卡片页：[history.png](./history.png)
- 新建转录弹窗（名称 + 标签）：[history-create-dialog.png](./history-create-dialog.png)
- 视觉对照与浏览器验证：仓库根目录 `design-qa.md`

## 关键可观测锚点

- 历史区：`rec-history-page`、`rec-history-count`、`rec-history-grid`、`rec-history-card-<sessionId>`
- 筛选区：`rec-history-tag-<tag>`、`rec-history-search`、`rec-history-sort`
- 创建入口：`rec-create-open`、`rec-create-card`
- 创建弹窗：`rec-create-dialog`、`rec-create-name`、`rec-create-name-count`、`rec-create-tags`、`rec-create-tag-count`、`rec-create-cancel`、`rec-create-submit`
- 边缘状态：`loading`、`rec-history-empty`、`rec-history-error`、`saved`

## 待人类确认

1. 历史页采用全局图标栏 + 单一内容区，不保留旧版第二侧栏和右侧状态栏。
2. 新建入口放在右上角，同时在卡片网格尾部保留虚线快捷卡片。
3. 新建弹窗先收集名称与最多 5 个标签；提交后进入实时转录。
4. UI 确认后再切正式契约束并补 `contracts/<bundle>/ui.md`，本阶段不自行发明束名或修改任何签核状态。

