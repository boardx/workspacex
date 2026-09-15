# 原始需求（概览 / 索引）— postinvest-rating-agent（Phase 16）

> 本文件夹的全部 `*.md` 是 **requirement-author** 的输入；权威永远是 `../feature_list.json`。

## 用户原话（2026-09-15，人类直接交办）

- 「根据我们 workspacex 现在有的 skills 和 tools，以及附件的需求文档，来设计一个独立的 agent，
  他的链接地址是 `http://www.boardx.com.cn/agent/team…`，开发一个需求文档，描述这个新的 agent 的需求和整个
  交互的过程，需求需要充分利用当前有的能力。」
- 附带四份材料：HMW 问题定义卡（手写照片）、《投后财务项目评级 Agent — 大模型测试方案与模拟测试文件》v1.0
  （PDF，评分规则权威原文）、序列图（三阶段交互）、MAAU 画布。
  这四份的原图 / 原 PDF 请人类放到 `../ui-preview/refs/`，本仓不由 agent 代为提交二进制附件。

## 阅读顺序

1. `01-postinvest-rating-agent.md` — UC-16.1 全文（R1–R12 + 能力复用矩阵 + 序列图文字版）。

## 待人类决定（汇总自 01 的 R10）

| # | 决定 | 默认假设 |
|---|---|---|
| D1 | 路由是 `/agent/team1` 还是 `/agent/team2` | team2 |
| D2 | 行业背景可信渠道白名单初始清单 | 空（跳过行业背景段） |
| D3 | 与资深投资经理偏差阈值 + 试点项目名单 | 未定，不进 feature 验收 |
| D4 | 新 skill 包目录 | `skills/standard-finance/postinvest-rating` |
| D5 | 录音上传路径 | `files.ts` 原件上传，不扩聊天附件白名单 |
