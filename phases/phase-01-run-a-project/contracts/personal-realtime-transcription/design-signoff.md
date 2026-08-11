---
bundle: personal-realtime-transcription
phase: "01"
covers: [F158, F159, F160]
status: pending
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `personal-realtime-transcription` 设计签核

本束是 issue #945 的正式签核面，覆盖用户私有历史工作台、Fun-ASR 状态机、一次性 ticket、AudioWorklet 与最终段持久化。它不修改已签 `recording` 束的项目录音语义；项目录音继续使用原契约。

## ① UI

请核对 [ui.md](./ui.md)：历史卡片与新建弹窗是否符合已选方案；详情页是否只保留一个开始/停止按钮与逐字稿；错误和收尾状态是否足够明确。

## ② 用例

请核对 [usecases.md](./usecases.md)：用户私有 owner 边界、重复开始形成多个 capture run、final 先落库后推送、停止等待 `task-finished` 是否正确。

## ③ API 契约

请核对 [usecases.md](./usecases.md) 的 HTTP/WS 形状与错误码。实现时唯一运行时 schema 落在 `packages/contracts/src/personal-realtime-transcription.ts`，前后端共同 import，不复制第二份类型。

## 支撑材料

- [domain.md](./domain.md)：实体和不变量。
- [coverage.md](./coverage.md)：UC-5.5 验收线索与接口、UI 的双向覆盖。

## 人类确认动作

人类逐节确认后修改 frontmatter 的 `status/confirmed_by/confirmed_at`。agent 不得修改签核状态；阶段一致性复核还必须覆盖本束后，F158–F160 才能进入 sprint。
