# `personal-realtime-transcription` UI

> 截图自检：本文件引用 3 张截图，目录下实际 3 张。

## 历史页与创建

- `ui-preview/realtime-transcription/history.png`
- `ui-preview/realtime-transcription/history-create-dialog.png`

稳定锚点：`rec-history-page`、`rec-history-count`、`rec-history-search`、`rec-history-sort`、`rec-history-grid`、`rec-history-card-<id>`、`rec-create-open`、`rec-create-dialog`、`rec-create-name`、`rec-create-tags`、`rec-create-submit`。

创建弹窗只收名称和标签，不出现项目选择。创建成功进入详情，但直到用户点“开始转录”才申请麦克风。

## 实时详情

- `ui-preview/realtime-transcription/live-workspace.png`

详情主区域只有 `rec-live-toggle` 与 `rec-live-transcript`。保留顶部返回、名称与 `rec-live-status`；移除详情页内的分析、报告、引用和 Skill 面板。

按钮状态：idle/completed/failed 为“开始转录”；connecting/waiting/recording 为“停止转录”；finalizing 为“正在收尾”且 disabled。
